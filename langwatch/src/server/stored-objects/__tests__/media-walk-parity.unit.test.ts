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
 */

import { describe, expect, it, vi } from "vitest";
import {
  EXTRACTABLE_PART_EXAMPLES,
  NON_EXTRACTABLE_PART_EXAMPLES,
} from "~/shared/content-parts/__tests__/canonical-media-parts";
import { containsMediaMarkers } from "~/shared/content-parts/media-markers";
import { collectMediaParts } from "~/shared/traces/mediaParts";
import { processContentPart } from "../content-extractor";
import type { StoredObjectsService } from "../stored-objects.service";
import { isExtractableMediaPart } from "../value-media-extractor";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

function makeFakeService(): StoredObjectsService {
  let count = 0;
  return {
    storeFromBytes: async ({ mediaType }: { mediaType: string }) => {
      count += 1;
      return { id: `so-${count}`, mediaType, isDuplicate: false };
    },
  } as unknown as StoredObjectsService;
}

const PARAMS = {
  projectId: "proj-1",
  purpose: "trace_content",
  ownerKind: "trace",
  ownerId: "trace-1",
};

describe("media walk parity", () => {
  describe.each(
    EXTRACTABLE_PART_EXAMPLES,
  )("given the extractable shape: $name", ({ part }) => {
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
      const collected = collectMediaParts([
        { role: "user", content: [rewritten] },
      ]);
      expect(collected.length).toBeGreaterThan(0);
    });
  });

  describe.each(
    NON_EXTRACTABLE_PART_EXAMPLES,
  )("given the non-extractable shape: $name", ({ part }) => {
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
  });
});
