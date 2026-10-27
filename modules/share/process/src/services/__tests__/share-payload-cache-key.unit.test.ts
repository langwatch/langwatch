import { describe, expect, it } from "vitest";

import { ShareService } from "../share.service.ts";

const buildSharedTraceCacheKey = (...args: Parameters<typeof ShareService.buildPayloadCacheKey>) =>
  ShareService.buildPayloadCacheKey(...args);

/**
 * The cache key keeps two viewers of one link apart: the same trace redacts differently per viewer
 * (spend needs `cost:view`), so a key ignoring protections would leak. See ADR-057.
 */
describe("buildSharedTraceCacheKey", () => {
  const anonymous = {
    canSeeCosts: false,
    canSeeCapturedInput: false,
    canSeeCapturedOutput: false,
    visibilityCutoffMs: null,
  };

  describe("given the same token and the same protections", () => {
    it("builds the same key", () => {
      expect(buildSharedTraceCacheKey({ token: "tok", protections: anonymous })).toBe(
        buildSharedTraceCacheKey({ token: "tok", protections: anonymous }),
      );
    });

    it("ignores key order in the protections object", () => {
      const reordered = {
        visibilityCutoffMs: null,
        canSeeCapturedOutput: false,
        canSeeCapturedInput: false,
        canSeeCosts: false,
      };

      expect(buildSharedTraceCacheKey({ token: "tok", protections: reordered })).toBe(
        buildSharedTraceCacheKey({ token: "tok", protections: anonymous }),
      );
    });
  });

  describe("given viewers whose redactions differ", () => {
    /** @scenario Two viewers with different redactions never see each other's payload */
    it("builds different keys for a cost-visible viewer", () => {
      const withCosts = { ...anonymous, canSeeCosts: true };

      expect(buildSharedTraceCacheKey({ token: "tok", protections: withCosts })).not.toBe(
        buildSharedTraceCacheKey({ token: "tok", protections: anonymous }),
      );
    });

    it("builds different keys for a content-visible viewer", () => {
      const withContent = { ...anonymous, canSeeCapturedInput: true };

      expect(buildSharedTraceCacheKey({ token: "tok", protections: withContent })).not.toBe(
        buildSharedTraceCacheKey({ token: "tok", protections: anonymous }),
      );
    });

    it("builds different keys for a narrower visibility window", () => {
      const windowed = { ...anonymous, visibilityCutoffMs: 1_700_000_000_000 };

      expect(buildSharedTraceCacheKey({ token: "tok", protections: windowed })).not.toBe(
        buildSharedTraceCacheKey({ token: "tok", protections: anonymous }),
      );
    });
  });

  describe("given different tokens", () => {
    it("builds different keys", () => {
      expect(buildSharedTraceCacheKey({ token: "tok_a", protections: anonymous })).not.toBe(
        buildSharedTraceCacheKey({ token: "tok_b", protections: anonymous }),
      );
    });
  });
});
