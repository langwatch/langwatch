/**
 * @vitest-environment node
 *
 * Parity pins between the three views of the media-part vocabulary
 * (specs/trace-processing/trace-media-blob-extraction.feature — the marker
 * gate and the walker/collector agreement):
 *
 *  1. `isExtractableMediaPart` (the sync classifier the extraction walker
 *     stops on) agrees with `processContentPart` (the store-side rewriter)
 *     for every canonical shape — a disagreement means a part is either
 *     stored twice-walked or silently skipped.
 *  2. The serialized form of every extractable shape trips
 *     `containsMediaMarkers` — a visitor shape without a matching marker
 *     regresses extraction to passthrough with no failing test.
 *  3. The render-side collector surfaces every shape, pre- AND
 *     post-extraction — bytes the extractor stores that nothing renders are
 *     invisible storage cost.
 *
 * Was `platform/app/src/server/stored-objects/__tests__/media-walk-parity.unit.test.ts`.
 * `isExtractableMediaPart` and `processContentPart` now live in this package
 * (`trace-value-media-extraction.service` / `trace-content-extraction.service`);
 * `containsMediaMarkers` and `collectMediaParts` moved to `@langwatch/trace-contract`.
 * The store-side dependency `processContentPart` takes is a `TraceMediaStorePort`
 * now, not the platform's own `StoredObjectsService` — this test fakes that
 * port the way `trace-content-extraction.service.unit.test.ts` already does.
 */
import { containsMediaMarkers, collectMediaParts } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceMediaStorePort } from "../../ports/trace-media-store.port";
import { processContentPart } from "../trace-content-extraction.service";
import { isExtractableMediaPart } from "../trace-value-media-extraction.service";
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
 * The contract package's `collectMediaParts` is a documented, pinned
 * subtraction from the render collector: it never wraps a raw, header-less
 * realtime PCM turn in a playable WAV (`isRawPcmFormat` in
 * `trace-media-part.collector.ts` — "THE ONE DELIBERATE DIFFERENCE FROM THE
 * TWIN"), because that wrapping needs `Buffer`/`atob` and this package stays
 * environment-neutral. Only the trace web surface's own collector
 * (`trace-media-ref.unit.test.ts` pins it there) renders such a part. The
 * one example carrying a raw-PCM format is excluded from the two
 * render-collector assertions below for that reason — every other assertion
 * in this suite (classifier, rewriter, marker gate) still covers it.
 */
const RENDER_COLLECTOR_EXAMPLES = EXTRACTABLE_PART_EXAMPLES.filter(
  ({ name }) => name !== "AI-SDK audio file part",
);

describe("media walk parity", () => {
  describe.each(EXTRACTABLE_PART_EXAMPLES)("given the extractable shape: $name", ({ part }) => {
    it("is classified extractable, matching the store-side rewriter", async () => {
      expect(isExtractableMediaPart(part)).toBe(true);
      const { part: rewritten, ref } = await processContentPart({
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
      const { part: rewritten } = await processContentPart({
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
        expect(isExtractableMediaPart(part)).toBe(false);
        const { part: rewritten, ref } = await processContentPart({
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
