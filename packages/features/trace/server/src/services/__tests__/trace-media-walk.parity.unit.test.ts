/**
 * @vitest-environment node
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 * Parity pins between the three views of the media-part vocabulary: (1) isExtractableMediaPart (sync classifier the extraction walker stops on) agrees with processContentPart (store-side rewriter) for every canonical shape — disagreement means a part is twice-walked or silently skipped; (2) every extractable shape's serialized form trips containsMediaMarkers — a mismatch regresses extraction to passthrough with no failing test; (3) the render-side collector surfaces every shape pre- and post-extraction — unrendered stored bytes are invisible storage cost. The store-side dependency now takes a TraceMediaStorePort, not the platform's StoredObjectsService; this test fakes that port the way trace-content-extraction.service.unit.test.ts does.
 */
import { TraceValueMediaExtractionService } from "../trace-value-media-extraction.service";
import { TraceContentExtractionService } from "../trace-content-extraction.service";
import { containsMediaMarkers, collectMediaParts } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceMediaStorePort } from "../../ports/trace-media-store.port";
import {
  EXTRACTABLE_PART_EXAMPLES,
  NON_EXTRACTABLE_PART_EXAMPLES,
} from "./fixtures/canonical-media-parts.fixtures";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeFakeService(): TraceMediaStorePort {
  let count = 0;
  return {
    storeFromBytes: async ({ mediaType }: { mediaType: string }) => {
      count += 1;
      return { id: `so-${count}`, mediaType, isDuplicate: false };
    },
  } as unknown as TraceMediaStorePort;
}

const PARAMS = {
  projectId: "proj-1",
  purpose: "trace_content",
  ownerKind: "trace",
  ownerId: "trace-1",
};

/**
 * collectMediaParts is a documented, pinned subtraction from the render collector: it never wraps a raw, header-less realtime PCM turn in a playable WAV (isRawPcmFormat — "THE ONE DELIBERATE DIFFERENCE FROM THE TWIN"), since that needs Buffer/atob and this package stays environment-neutral. Only the trace web surface's own collector renders such a part (pinned in trace-media-ref.unit.test.ts). The one raw-PCM example is excluded from the two render-collector assertions below for that reason; every other assertion (classifier, rewriter, marker gate) still covers it.
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
