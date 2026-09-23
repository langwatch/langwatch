import { containsMediaMarkers, collectMediaParts } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceMediaStore } from "../../app/trace.members.ts";
import { TraceContentExtractionService } from "../trace-content-extraction.service.ts";
/**
 * @vitest-environment node
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 * Parity pins three media-part views: classifier, marker and render.
 */
import { TraceValueMediaExtractionService } from "../trace-value-media-extraction.service.ts";
import {
  EXTRACTABLE_PART_EXAMPLES,
  NON_EXTRACTABLE_PART_EXAMPLES,
} from "./fixtures/canonical-media-parts.fixtures.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeFakeService(): TraceMediaStore {
  let count = 0;
  return {
    storeFromBytes: async ({ mediaType }: { mediaType: string }) => {
      count += 1;
      return { id: `so-${count}`, mediaType, isDuplicate: false };
    },
  };
}

const PARAMS = {
  projectId: "proj-1",
  purpose: "trace_content",
  ownerKind: "trace",
  ownerId: "trace-1",
};

/**
 * collectMediaParts doesn't wrap raw PCM to WAV (needs Buffer/atob). Raw-PCM
 * example excluded from two render-collector assertions below; classifier,
 * rewriter, and marker gate checks still cover it.
 */
const RENDER_COLLECTOR_EXAMPLES = EXTRACTABLE_PART_EXAMPLES.filter(
  ({ name }) => name !== "AI-SDK audio file part",
);

describe("media walk parity", () => {
  describe.each(EXTRACTABLE_PART_EXAMPLES)("given the extractable shape: $name", ({ part }) => {
    it("is classified extractable, matching the store-side rewriter", async () => {
      expect(TraceValueMediaExtractionService.isExtractableMediaPart(part)).toBe(true);
      const { part: rewritten, ref } = await TraceContentExtractionService.processContentPart({
        part,
        service: makeFakeService(),
        ...PARAMS,
      });
      expect(ref).not.toBeNull();
      expect(rewritten).not.toBe(part);
    });

    /** @scenario Attributes without media markers are never parsed or rewritten */
    it("trips the media-marker gate in serialized form (plain and escaped)", () => {
      const wrapped = JSON.stringify([{ role: "user", content: [part] }]);
      expect(containsMediaMarkers(wrapped)).toBe(true);
      // Typed-raw envelopes carry the messages as an escaped JSON string —
      // the exact shape of the original bug report.
      const escaped = JSON.stringify({ type: "raw", value: wrapped });
      expect(containsMediaMarkers(escaped)).toBe(true);
    });
  });

  describe.each(RENDER_COLLECTOR_EXAMPLES)("given the extractable shape: $name", ({ part }) => {
    it("is surfaced by the render-side collector before extraction", () => {
      const collected = collectMediaParts([{ role: "user", content: [part] }]);
      expect(collected.length).toBeGreaterThan(0);
    });

    it("is surfaced by the render-side collector after extraction", async () => {
      const { part: rewritten } = await TraceContentExtractionService.processContentPart({
        part,
        service: makeFakeService(),
        ...PARAMS,
      });
      const collected = collectMediaParts([{ role: "user", content: [rewritten] }]);
      expect(collected.length).toBeGreaterThan(0);
    });
  });

  describe.each(NON_EXTRACTABLE_PART_EXAMPLES)(
    "given the non-extractable shape: $name",
    ({ part }) => {
      it("is not classified extractable and passes the rewriter untouched", async () => {
        expect(TraceValueMediaExtractionService.isExtractableMediaPart(part)).toBe(false);
        const { part: rewritten, ref } = await TraceContentExtractionService.processContentPart({
          part,
          service: makeFakeService(),
          ...PARAMS,
        });
        expect(ref).toBeNull();
        expect(rewritten).toBe(part);
      });
    },
  );
});
