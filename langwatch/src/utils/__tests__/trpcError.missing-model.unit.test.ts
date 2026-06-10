/**
 * Unit tests for `extractMissingModelInfo` — the tRPC error extractor that
 * the global QueryCache + MutationCache interceptor uses to drive the
 * MissingModelModal. Mirrors the existing `extractLimitExceededInfo` /
 * `extractLiteMemberRestrictionInfo` extractor tests.
 */
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import {
  extractMissingModelInfo,
  isHandledByMissingModelHandler,
  markAsHandledByMissingModelHandler,
} from "../trpcError";

function buildError(
  cause: Record<string, unknown> | undefined,
  code: string = "BAD_REQUEST",
): TRPCClientError<any> {
  const err = new TRPCClientError<any>("Model not configured");
  // The TRPC client populates `error.data` from the server's
  // `TRPCError.cause` shape — match it directly here so tests cover the
  // wire contract the interceptor reads.
  (err as { data?: unknown }).data = { code, cause };
  return err;
}

describe("extractMissingModelInfo()", () => {
  describe("when the cause carries the MODEL_NOT_CONFIGURED code", () => {
    /** @scenario A tRPC call that throws ModelNotConfigured opens the toast */
    it("returns the featureKey, displayName, role, and projectId", () => {
      const err = buildError({
        code: "MODEL_NOT_CONFIGURED",
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "proj-1",
      });

      expect(extractMissingModelInfo(err)).toEqual({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "proj-1",
      });
    });

    it("falls back to the featureKey for displayName when it is missing", () => {
      const err = buildError({
        code: "MODEL_NOT_CONFIGURED",
        featureKey: "studio.autocomplete",
        role: "FAST",
      });

      const info = extractMissingModelInfo(err);
      expect(info?.featureDisplayName).toBe("studio.autocomplete");
    });
  });

  describe("when the cause does not match", () => {
    it("returns null for an unrelated cause code", () => {
      expect(
        extractMissingModelInfo(
          buildError({ code: "LIMIT_EXCEEDED", limitType: "members" }),
        ),
      ).toBeNull();
    });

    it("returns null when role is not one of the three known roles", () => {
      expect(
        extractMissingModelInfo(
          buildError({
            code: "MODEL_NOT_CONFIGURED",
            featureKey: "x",
            role: "MYSTERY",
          }),
        ),
      ).toBeNull();
    });

    it("returns null when featureKey is missing", () => {
      expect(
        extractMissingModelInfo(
          buildError({ code: "MODEL_NOT_CONFIGURED", role: "FAST" }),
        ),
      ).toBeNull();
    });

    it("returns null for a non-TRPC error", () => {
      expect(extractMissingModelInfo(new Error("nope"))).toBeNull();
      expect(extractMissingModelInfo(null)).toBeNull();
      expect(extractMissingModelInfo(undefined)).toBeNull();
    });
  });
});

describe("isHandledByMissingModelHandler()", () => {
  it("returns true for an error previously marked", () => {
    const err = new Error("Model not configured");
    markAsHandledByMissingModelHandler(err);
    expect(isHandledByMissingModelHandler(err)).toBe(true);
  });

  it("returns false for an unmarked error", () => {
    expect(isHandledByMissingModelHandler(new Error("plain"))).toBe(false);
  });
});
