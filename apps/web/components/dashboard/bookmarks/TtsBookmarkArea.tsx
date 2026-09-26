import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useSession } from "@/lib/auth/client";
import { useTranslation } from "@/lib/i18n/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FastForward,
  Headphones,
  Pause,
  Play,
  Rewind,
  Settings,
  X,
} from "lucide-react";

import { useGenerateTts } from "@karakeep/shared-react/hooks/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

function sortedTtsAssetIds(bookmark: ZBookmark): string[] {
  return bookmark.assets
    .filter((a) => a.assetType === "ttsAudio")
    .sort((a, b) => (a.fileName ?? "").localeCompare(b.fileName ?? ""))
    .map((a) => a.id);
}

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "error";

// Plays a sequence of pre-generated audio chunks back-to-back using the Web
// Audio API instead of a native <audio> element, so switching speed doesn't
// require a new <source> or losing the decoded buffers we've already
// fetched. Chunks past the end of `initialAssetIds` may still be generating
// in the background, so reaching the end triggers one `fetchMore` check
// before actually stopping.
function useGaplessChunkPlayer(
  initialAssetIds: string[],
  fetchMore: () => Promise<string[]>,
) {
  const assetIdsRef = useRef<string[]>(initialAssetIds);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const buffersRef = useRef<Map<number, AudioBuffer>>(new Map());
  const [state, setState] = useState<PlaybackState>("idle");
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);

  useEffect(() => {
    if (initialAssetIds.length > assetIdsRef.current.length) {
      assetIdsRef.current = initialAssetIds;
    }
  }, [initialAssetIds]);

  useEffect(() => {
    speedRef.current = speed;
    if (sourceRef.current) {
      sourceRef.current.playbackRate.value = speed;
    }
  }, [speed]);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  const loadBuffer = useCallback(
    async (i: number) => {
      const cached = buffersRef.current.get(i);
      if (cached) {
        return cached;
      }
      const res = await fetch(getAssetUrl(assetIdsRef.current[i]));
      if (!res.ok) {
        throw new Error(`Failed to fetch audio chunk ${i}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = await getCtx().decodeAudioData(arrayBuffer);
      buffersRef.current.set(i, buffer);
      return buffer;
    },
    [getCtx],
  );

  const stopCurrentSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch {
        // Already stopped.
      }
      sourceRef.current = null;
    }
  }, []);

  const playIndex = useCallback(
    async (i: number) => {
      if (i < 0) {
        return;
      }
      if (i >= assetIdsRef.current.length) {
        // More chunks may have finished generating in the background since
        // we last checked.
        try {
          const fresh = await fetchMore();
          if (fresh.length > assetIdsRef.current.length) {
            assetIdsRef.current = fresh;
          }
        } catch {
          // Treat a failed check the same as "no more chunks yet".
        }
        if (i >= assetIdsRef.current.length) {
          setState("idle");
          setIndex(0);
          return;
        }
      }
      stopCurrentSource();
      setState("loading");
      try {
        const buffer = await loadBuffer(i);
        // Prefetch the next chunk while this one plays so playback doesn't
        // stall waiting on the network.
        if (i + 1 < assetIdsRef.current.length) {
          // Prefetch errors surface when we actually try to play that chunk.
          void loadBuffer(i + 1).catch(() => undefined);
        }
        const ctx = getCtx();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = speedRef.current;
        source.connect(ctx.destination);
        source.onended = () => {
          if (sourceRef.current === source) {
            sourceRef.current = null;
            setIndex(i + 1);
            void playIndex(i + 1);
          }
        };
        sourceRef.current = source;
        source.start();
        setIndex(i);
        setState("playing");
      } catch {
        setState("error");
      }
    },
    [fetchMore, getCtx, loadBuffer, stopCurrentSource],
  );

  const play = useCallback(() => {
    const ctx = getCtx();
    if (state === "paused" && ctx.state === "suspended") {
      void ctx.resume();
      setState("playing");
      return;
    }
    void playIndex(index);
  }, [getCtx, index, playIndex, state]);

  const pause = useCallback(() => {
    audioCtxRef.current?.suspend();
    setState("paused");
  }, []);

  const stop = useCallback(() => {
    stopCurrentSource();
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    buffersRef.current.clear();
    setState("idle");
    setIndex(0);
  }, [stopCurrentSource]);

  const skip = useCallback(
    (delta: number) => {
      void playIndex(index + delta);
    },
    [index, playIndex],
  );

  useEffect(
    () => () => {
      stopCurrentSource();
      audioCtxRef.current?.close();
    },
    [stopCurrentSource],
  );

  return {
    state,
    index,
    speed,
    setSpeed,
    play,
    pause,
    stop,
    skip,
  };
}

function TtsPlayer({
  assetIds,
  fetchMore,
  onClose,
}: {
  assetIds: string[];
  fetchMore: () => Promise<string[]>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const player = useGaplessChunkPlayer(assetIds, fetchMore);
  const isPlaying = player.state === "playing" || player.state === "loading";

  return (
    <div className="relative flex w-full flex-col gap-2 rounded-xl border bg-white/50 p-3 shadow-lg backdrop-blur-lg dark:bg-black/50 lg:w-auto lg:min-w-80">
      <button
        aria-label="Close"
        onClick={() => {
          player.stop();
          onClose();
        }}
        className="absolute -right-2 -top-2 rounded-full border bg-background p-1 text-muted-foreground shadow hover:bg-muted hover:text-foreground"
      >
        <X size={12} />
      </button>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={player.state === "loading"}
          onClick={() => (isPlaying ? player.pause() : player.play())}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Jump back"
          disabled={player.index <= 0}
          onClick={() => player.skip(-1)}
        >
          <Rewind size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Jump forward"
          onClick={() => player.skip(1)}
        >
          <FastForward size={16} />
        </Button>
        <select
          className="ml-auto rounded-md border border-input bg-background px-1.5 py-1 text-xs"
          value={player.speed}
          onChange={(e) => player.setSpeed(parseFloat(e.target.value))}
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        {isAdmin && (
          <Link href="/admin/tts" target="_blank" rel="noopener noreferrer">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Text-to-speech settings"
            >
              <Settings size={16} />
            </Button>
          </Link>
        )}
      </div>
      {player.state === "error" && (
        <p className="text-xs text-destructive">
          {t("actions.audio_generation_failed")}
        </p>
      )}
    </div>
  );
}

export default function TtsBookmarkArea({
  bookmark,
  readOnly = false,
}: {
  bookmark: ZBookmark;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { data: ttsConfig } = useQuery(api.tts.isConfigured.queryOptions());
  const [dismissed, setDismissed] = useState(false);
  const { mutate, isPending } = useGenerateTts({
    onError: () => {
      toast({
        description: "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const fetchMoreChunks = useCallback(async () => {
    const fresh = await queryClient.fetchQuery(
      api.bookmarks.getBookmark.queryOptions({
        bookmarkId: bookmark.id,
        includeContent: false,
      }),
    );
    return sortedTtsAssetIds(fresh);
  }, [api, bookmark.id, queryClient]);

  let body: ReactNode = null;
  if (
    !dismissed &&
    (bookmark.content.type === BookmarkTypes.LINK ||
      bookmark.content.type === BookmarkTypes.TEXT)
  ) {
    const { ttsStatus } = bookmark;
    const ttsAudioAssetIds = sortedTtsAssetIds(bookmark);

    if (ttsAudioAssetIds.length > 0) {
      body = (
        // Keyed on the bookmark so navigating to a different bookmark
        // without a full remount (e.g. client-side preview nav) resets the
        // player's internal chunk-list ref instead of continuing to serve
        // the previous bookmark's audio.
        <TtsPlayer
          key={bookmark.id}
          assetIds={ttsAudioAssetIds}
          fetchMore={fetchMoreChunks}
          onClose={() => setDismissed(true)}
        />
      );
    } else if (ttsStatus === "pending") {
      body = (
        <ActionButton
          variant="secondary"
          className="shadow-lg"
          loading={true}
          disabled
        >
          {t("actions.generating_audio")}
        </ActionButton>
      );
    } else if (ttsConfig?.isConfigured && !readOnly) {
      body = (
        <div className="flex flex-col items-center gap-1">
          <ActionButton
            onClick={() => mutate({ bookmarkId: bookmark.id })}
            variant="secondary"
            className="shadow-lg"
            loading={isPending}
          >
            <span className="flex items-center gap-1.5">
              {ttsStatus === "failure"
                ? t("actions.retry")
                : t("actions.listen")}
              <Headphones className="size-4" />
            </span>
          </ActionButton>
          {ttsStatus === "failure" && (
            <p className="rounded bg-background px-2 py-1 text-xs text-destructive shadow">
              {t("actions.audio_generation_failed")}
            </p>
          )}
        </div>
      );
    }
  }

  if (body === null) {
    return null;
  }
  return body;
}
