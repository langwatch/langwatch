import { describe, expect, it } from "vitest";

import { deriveOccurredAtBackfill } from "../trace-occurred-at-backfill.ts";

const header = { traceId: "trace-1", timestamp: 1_700_000_000_000 };
const base = { occurredAtMs: null, header, traceId: "trace-1", isPlaceholderData: false };

describe("deriveOccurredAtBackfill", () => {
  describe("given the drawer opened without a partition hint", () => {
    describe("when the fetched header lands", () => {
      it("takes the header's timestamp", () => {
        expect(deriveOccurredAtBackfill(base)).toBe(1_700_000_000_000);
      });
    });

    describe("when the header is the list row's placeholder", () => {
      it("takes nothing from it", () => {
        expect(deriveOccurredAtBackfill({ ...base, isPlaceholderData: true })).toBeUndefined();
      });
    });

    describe("when the header belongs to another trace", () => {
      it("takes nothing from it", () => {
        expect(deriveOccurredAtBackfill({ ...base, traceId: "trace-2" })).toBeUndefined();
      });
    });

    describe("when no header has landed", () => {
      it("takes nothing", () => {
        expect(deriveOccurredAtBackfill({ ...base, header: undefined })).toBeUndefined();
      });
    });
  });

  describe("given the drawer already has a partition hint", () => {
    it("keeps it", () => {
      expect(deriveOccurredAtBackfill({ ...base, occurredAtMs: 5 })).toBeUndefined();
    });
  });
});
