/**
 * Schema-level guard for the `tracesV2.list` input (#5835 / #5854 review):
 * `resolveFullIO: true` fans out a per-row span read + event_log restore for
 * every row, so pairing it with a large `pageSize` multiplies that work. The
 * input schema rejects `resolveFullIO` combined with a `pageSize` above
 * `MAX_RESOLVE_FULL_IO_PAGE_SIZE`, while ordinary preview-only listing keeps the
 * full `.max(1000)`.
 *
 * Structural template: tracesV2.header.unit.test.ts (same layer — a pure export
 * from tracesV2.ts exercised directly).
 */

import { describe, expect, it } from "vitest";
import { listInputSchema, MAX_RESOLVE_FULL_IO_PAGE_SIZE } from "../tracesV2";

const baseInput = {
  projectId: "proj-1",
  timeRange: { from: 0, to: 1 },
  sort: { columnId: "time", direction: "asc" as const },
};

describe("tracesV2 listInputSchema resolveFullIO pageSize guard", () => {
  describe("given resolveFullIO is set", () => {
    describe("when pageSize is above the full-IO cap", () => {
      it("rejects the input and points the error at pageSize", () => {
        const result = listInputSchema.safeParse({
          ...baseInput,
          resolveFullIO: true,
          pageSize: 1000,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.path).toContain("pageSize");
        }
      });

      it("rejects a pageSize just one over the cap", () => {
        const result = listInputSchema.safeParse({
          ...baseInput,
          resolveFullIO: true,
          pageSize: MAX_RESOLVE_FULL_IO_PAGE_SIZE + 1,
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when pageSize is at or below the full-IO cap", () => {
      it("accepts a pageSize equal to the cap (the Conversation tab's request)", () => {
        const result = listInputSchema.safeParse({
          ...baseInput,
          resolveFullIO: true,
          pageSize: MAX_RESOLVE_FULL_IO_PAGE_SIZE,
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe("given resolveFullIO is omitted (the grid's preview-only path)", () => {
    describe("when pageSize is the full maximum", () => {
      it("accepts pageSize up to 1000 — the cap only applies to full-IO requests", () => {
        const result = listInputSchema.safeParse({
          ...baseInput,
          pageSize: 1000,
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe("given resolveFullIO is explicitly false", () => {
    describe("when pageSize exceeds the full-IO cap", () => {
      it("accepts the input — the guard only fires when resolveFullIO is truthy", () => {
        const result = listInputSchema.safeParse({
          ...baseInput,
          resolveFullIO: false,
          pageSize: 1000,
        });

        expect(result.success).toBe(true);
      });
    });
  });
});
