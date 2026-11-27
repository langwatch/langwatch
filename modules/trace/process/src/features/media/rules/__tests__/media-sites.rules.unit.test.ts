/**
 * @vitest-environment node
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 */
import { describe, expect, it } from "vitest";

import { findMediaSites } from "../media-sites.rules.ts";

describe("findMediaSites", () => {
  describe("given a nested JSON string of messages larger than 50 MiB", () => {
    /** @scenario "Media inside a nested JSON string larger than 50 MiB is still found" */
    it("finds the audio part inside it", () => {
      const audio = "A".repeat(51 * 1024 * 1024);
      const messages = JSON.stringify([
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: audio, format: "wav" } }],
        },
      ]);

      const sites = findMediaSites({ value: messages });

      expect(sites).toHaveLength(1);
      expect(sites[0]?.kind).toBe("part");
      expect(sites[0]?.path).toEqual([
        { key: "value" },
        { json: true },
        { index: 0 },
        { key: "content" },
        { index: 0 },
      ]);
    });
  });
});
