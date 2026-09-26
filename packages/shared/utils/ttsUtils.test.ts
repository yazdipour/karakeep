import { describe, expect, it } from "vitest";

import {
  chunkTextForTts,
  htmlToNarrationText,
  stripUrlsForNarration,
  ttsChunkFileName,
} from "./ttsUtils";

describe("chunkTextForTts", () => {
  it("splits text on paragraph boundaries", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    expect(chunkTextForTts(text)).toEqual([
      "First paragraph.",
      "Second paragraph.",
      "Third paragraph.",
    ]);
  });

  it("ignores empty paragraphs and collapses inner whitespace", () => {
    const text = "Hello   world.\n\n\n\nGoodbye\nworld.";
    expect(chunkTextForTts(text)).toEqual(["Hello world.", "Goodbye world."]);
  });

  it("splits paragraphs longer than the max size on sentence boundaries", () => {
    const sentence = "This is a sentence.";
    const paragraph = Array(10).fill(sentence).join(" "); // 200 chars
    const chunks = chunkTextForTts(paragraph, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
    expect(chunks.join(" ")).toBe(paragraph);
  });

  it("keeps a single sentence longer than maxChunkChars as its own chunk", () => {
    const longSentence = "a".repeat(100) + ".";
    expect(chunkTextForTts(longSentence, 50)).toEqual([longSentence]);
  });

  it("returns an empty array for blank input", () => {
    expect(chunkTextForTts("   \n\n  ")).toEqual([]);
  });
});

describe("stripUrlsForNarration", () => {
  it("keeps the link text from markdown links and drops the URL", () => {
    expect(
      stripUrlsForNarration(
        "See [the docs](https://example.com/docs) for more.",
      ),
    ).toBe("See the docs for more.");
  });

  it("removes bare URLs entirely", () => {
    expect(
      stripUrlsForNarration("Check out https://example.com/path?q=1 now."),
    ).toBe("Check out  now.".replace(/ {2,}/g, " "));
  });
});

describe("htmlToNarrationText", () => {
  it("skips code blocks and images", () => {
    const html =
      '<p>Run this:</p><pre><code>const x = 1;</code></pre><p>Done.</p><img src="x.png">';
    const text = htmlToNarrationText(html);
    expect(text).not.toContain("const x");
    expect(text).toContain("Run this:");
    expect(text).toContain("Done.");
  });

  it("keeps link text but drops the href", () => {
    const html = '<p>See <a href="https://example.com/page">this page</a>.</p>';
    const text = htmlToNarrationText(html);
    expect(text).toContain("this page");
    expect(text).not.toContain("example.com");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToNarrationText("")).toBe("");
  });
});

describe("ttsChunkFileName", () => {
  it("zero-pads so filenames sort in playback order", () => {
    const names = [10, 2, 1].map(ttsChunkFileName).sort();
    expect(names).toEqual([
      ttsChunkFileName(1),
      ttsChunkFileName(2),
      ttsChunkFileName(10),
    ]);
  });
});
