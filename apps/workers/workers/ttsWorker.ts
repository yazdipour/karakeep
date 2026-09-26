import { eq } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import { withWorkerEventLog, withWorkerTracing } from "workerTracing";

import { db } from "@karakeep/db";
import { assets, AssetTypes, bookmarks } from "@karakeep/db/schema";
import {
  addLogFields,
  ASSET_TYPES,
  newAssetId,
  QuotaService,
  saveAsset,
  silentDeleteAsset,
  TtsProviderConfig,
  TtsProviderConfigService,
  TtsQueue,
  ZTtsRequest,
  zTtsRequestSchema,
} from "@karakeep/shared-server";
import { limitConcurrency } from "@karakeep/shared/concurrency";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import {
  chunkTextForTts,
  htmlToNarrationText,
  stripUrlsForNarration,
  ttsChunkFileName,
} from "@karakeep/shared/utils/ttsUtils";
import { Bookmark } from "@karakeep/trpc/models/bookmarks";

const MAX_CHUNKS = 300;
// Kept modest: most Kokoro-style servers run on a single GPU/CPU box, so
// piling on more concurrent requests just queues up on their side.
const SYNTHESIS_CONCURRENCY = 4;
// Only synthesize this many chunks before marking the bookmark playable; the
// rest keep generating in the background so the user isn't stuck waiting for
// the whole article before they can start listening.
const INITIAL_CHUNKS = 3;

async function attemptMarkStatus(
  jobData: object | undefined,
  status: "failure",
) {
  if (!jobData) {
    return;
  }
  try {
    const request = zTtsRequestSchema.parse(jobData);
    await db
      .update(bookmarks)
      .set({ ttsStatus: status })
      .where(eq(bookmarks.id, request.bookmarkId));
  } catch (e) {
    logger.error(`Something went wrong when marking the tts status: ${e}`);
  }
}

export class TtsWorker {
  static async build() {
    logger.info("Starting tts worker ...");
    const worker = (await getQueueClient())!.createRunner<ZTtsRequest>(
      TtsQueue,
      {
        run: withWorkerTracing(
          "ttsWorker.run",
          withWorkerEventLog("ttsWorker.run", runTts),
        ),
        onComplete: async (job) => {
          workerStatsCounter.labels("tts", "completed").inc();
          logger.info(`[tts][${job.id}] Completed successfully`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("tts", "failed").inc();
          logger.error(
            `[tts][${job.id}] tts job failed: ${job.error}\n${job.error.stack}`,
          );
          if (job.numRetriesLeft == 0) {
            workerStatsCounter.labels("tts", "failed_permanent").inc();
            await attemptMarkStatus(job?.data, "failure");
          }
        },
      },
      {
        concurrency: serverConfig.tts.numWorkers,
        pollIntervalMs: 1000,
        timeoutSecs: serverConfig.tts.jobTimeoutSec,
      },
    );
    return worker;
  }
}

async function synthesizeChunk(
  text: string,
  provider: TtsProviderConfig,
): Promise<Buffer> {
  const { baseUrl, apiKey, model, voice } = provider;
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(serverConfig.tts.timeoutSec * 1000),
  });
  if (!response.ok) {
    throw new Error(
      `TTS server returned ${response.status}: ${await response.text()}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function getNarrationText(
  bookmarkId: string,
  userId: string,
): Promise<string | null> {
  const bookmark = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    with: { link: true, text: true },
  });
  if (!bookmark) {
    return null;
  }
  if (bookmark.type === BookmarkTypes.LINK && bookmark.link) {
    const html = await Bookmark.getBookmarkHtmlContent(bookmark.link, userId);
    return html ? htmlToNarrationText(html) : null;
  }
  if (bookmark.type === BookmarkTypes.TEXT && bookmark.text) {
    return bookmark.text.text
      ? stripUrlsForNarration(bookmark.text.text)
      : null;
  }
  return null;
}

async function runTts(job: DequeuedJob<ZTtsRequest>) {
  const jobId = job.id;
  const providerConfig = await TtsProviderConfigService.get(db);
  if (!providerConfig) {
    logger.debug(`[tts][${jobId}] No TTS server configured, nothing to do`);
    return;
  }
  // Narrowed to a local so the nested synthesizeAndSaveBatch closure below
  // (which TS can't narrow across) sees a non-null type.
  const provider: TtsProviderConfig = providerConfig;

  const request = zTtsRequestSchema.safeParse(job.data);
  if (!request.success) {
    throw new Error(
      `[tts][${jobId}] Got malformed job request: ${request.error.toString()}`,
    );
  }
  const { bookmarkId } = request.data;

  const bookmarkRow = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    columns: { userId: true },
  });
  if (!bookmarkRow) {
    throw new Error(`[tts][${jobId}] Bookmark ${bookmarkId} not found`);
  }
  const { userId } = bookmarkRow;

  addLogFields<"ttsWorker.run">({ "bookmark.id": bookmarkId });

  const text = await getNarrationText(bookmarkId, userId);
  if (!text || !text.trim()) {
    logger.info(
      `[tts][${jobId}] No content found for bookmark ${bookmarkId}, skipping.`,
    );
    await db
      .update(bookmarks)
      .set({ ttsStatus: "failure" })
      .where(eq(bookmarks.id, bookmarkId));
    return;
  }

  let chunks = chunkTextForTts(text);
  if (chunks.length > MAX_CHUNKS) {
    logger.warn(
      `[tts][${jobId}] Bookmark ${bookmarkId} has ${chunks.length} chunks, truncating to ${MAX_CHUNKS}`,
    );
    chunks = chunks.slice(0, MAX_CHUNKS);
  }
  addLogFields<"ttsWorker.run">({
    "tts.chunk_count": chunks.length,
    "tts.text_size": text.length,
  });
  logger.info(
    `[tts][${jobId}] Synthesizing ${chunks.length} chunk(s) for bookmark ${bookmarkId}`,
  );

  // Clean up any chunks left over from a previous attempt so filenames
  // (which encode playback order) start from a known state.
  const oldChunks = await db.query.assets.findMany({
    where: (a, { eq, and }) =>
      and(eq(a.bookmarkId, bookmarkId), eq(a.assetType, AssetTypes.TTS_AUDIO)),
    columns: { id: true },
  });
  for (const old of oldChunks) {
    await db.delete(assets).where(eq(assets.id, old.id));
    await silentDeleteAsset(userId, old.id);
  }

  // Fail fast if the user is already over their storage quota, rather than
  // spending TTS server compute/API cost on chunks we already know we can't
  // keep.
  await QuotaService.checkStorageQuota(db, userId, 1);

  async function synthesizeAndSaveBatch(batch: string[], startIndex: number) {
    const buffers = await Promise.all(
      limitConcurrency(
        batch.map((chunk) => () => synthesizeChunk(chunk, provider)),
        SYNTHESIS_CONCURRENCY,
      ),
    );
    const totalSize = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const quotaApproved = await QuotaService.checkStorageQuota(
      db,
      userId,
      totalSize,
    );
    const newRows = [];
    try {
      for (let i = 0; i < buffers.length; i++) {
        const assetId = newAssetId();
        await saveAsset({
          userId,
          assetId,
          asset: buffers[i],
          metadata: {
            contentType: ASSET_TYPES.AUDIO_MPEG,
            fileName: ttsChunkFileName(startIndex + i),
          },
          quotaApproved,
        });
        newRows.push({
          id: assetId,
          bookmarkId,
          userId,
          assetType: AssetTypes.TTS_AUDIO,
          contentType: ASSET_TYPES.AUDIO_MPEG,
          fileName: ttsChunkFileName(startIndex + i),
          size: buffers[i].byteLength,
        });
      }
    } catch (e) {
      // Some chunks in this batch may have already been written to the
      // asset store before the DB rows were inserted; clean those up so a
      // mid-batch failure doesn't leak orphaned files.
      for (const row of newRows) {
        await silentDeleteAsset(userId, row.id);
      }
      throw e;
    }
    await db.insert(assets).values(newRows);
    return newRows.map((r) => r.id);
  }

  const firstBatch = chunks.slice(0, INITIAL_CHUNKS);
  const restBatch = chunks.slice(INITIAL_CHUNKS);
  const savedIds: string[] = [];

  try {
    savedIds.push(...(await synthesizeAndSaveBatch(firstBatch, 0)));
    // The bookmark is playable as soon as the first batch lands; the rest
    // keeps generating in the background below.
    await db
      .update(bookmarks)
      .set({ ttsStatus: "success" })
      .where(eq(bookmarks.id, bookmarkId));
  } catch (e) {
    for (const assetId of savedIds) {
      await silentDeleteAsset(userId, assetId);
    }
    throw e;
  }

  if (restBatch.length > 0) {
    try {
      await synthesizeAndSaveBatch(restBatch, INITIAL_CHUNKS);
      logger.info(
        `[tts][${jobId}] Finished background generation of the remaining ${restBatch.length} chunk(s) for bookmark ${bookmarkId}`,
      );
    } catch (e) {
      // The bookmark already has playable audio from the first batch, so a
      // failure here just means a shorter narration rather than a failed job.
      logger.error(
        `[tts][${jobId}] Failed to generate the remaining chunks for bookmark ${bookmarkId}: ${e}`,
      );
    }
  }

  logger.info(
    `[tts][${jobId}] Saved ${firstBatch.length + restBatch.length} audio chunk(s) for bookmark ${bookmarkId}`,
  );
}
