import { compile } from "html-to-text";

// Separate from htmlToPlainText (used for summarization/tagging) because
// narration should skip code/links entirely rather than read URLs and
// snippets aloud, which both sounds bad and bloats the chunk count.
const narrationConverter = compile({
  selectors: [
    { selector: "img", format: "skip" },
    { selector: "a", options: { ignoreHref: true } },
    { selector: "pre", format: "skip" },
    { selector: "code", format: "skip" },
  ],
});

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((?:https?:\/\/|\/)[^)\s]*\)/g;
const BARE_URL_RE = /\bhttps?:\/\/\S+/gi;

/**
 * Strips markdown links and bare URLs down to their link text (or removes
 * them entirely), so a TTS engine doesn't read raw URLs aloud. Used both as
 * a final pass after HTML conversion and directly on plain-text bookmarks.
 */
export function stripUrlsForNarration(text: string): string {
  return text
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(BARE_URL_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

/**
 * Converts article HTML into narration-ready plain text: drops images, code
 * blocks and link URLs (keeping link text) so the TTS engine only reads the
 * actual prose.
 */
export function htmlToNarrationText(htmlContent: string): string {
  if (!htmlContent) {
    return "";
  }
  return stripUrlsForNarration(narrationConverter(htmlContent));
}

// Most TTS servers (including Kokoro) cap how much text a single request can
// synthesize. We split article text into paragraph-sized chunks, each
// synthesized and stored as a separate audio asset and played back gaplessly
// on the client.
const DEFAULT_MAX_CHUNK_CHARS = 2000;

/**
 * Splits plain text (as produced by html-to-text) into TTS-sized chunks,
 * preferring paragraph boundaries and falling back to sentence boundaries
 * for paragraphs longer than maxChunkChars.
 */
export function chunkTextForTts(
  text: string,
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
): string[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChunkChars) {
      chunks.push(paragraph);
      continue;
    }
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > maxChunkChars && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current) {
      chunks.push(current);
    }
  }
  return chunks;
}

/**
 * Zero-padded chunk filenames sort correctly (lexicographically) so playback
 * order can be derived from the asset store without a separate ordering
 * column.
 */
export function ttsChunkFileName(index: number): string {
  return `tts-${index.toString().padStart(5, "0")}.mp3`;
}
