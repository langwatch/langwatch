import { describe, expect, it } from "vitest";

import { parseDomainError } from "./domain-error.js";

/**
 * The platform speaks several error dialects (see `asErrorBody`). These pin the
 * reading of the versioned `packages/api` one, where `meta` is a nested object
 * and `message` is the code rather than a sentence — a handled error's own
 * message is server copy and never crosses the boundary (ADR-045).
 */
describe("parseDomainError", () => {
  describe("given the versioned body from packages/api", () => {
    const versioned = (overrides: Record<string, unknown> = {}) => ({
      code: "dataset_not_found",
      type: "dataset_not_found",
      kind: "dataset_not_found",
      message: "dataset_not_found",
      meta: { id: "ds_1" },
      fault: "customer",
      ...overrides,
    });

    it("reads the discriminant and keeps meta nested rather than lifting the envelope", () => {
      const parsed = parseDomainError({ status: 404, body: versioned() });

      expect(parsed.kind).toBe("dataset_not_found");
      expect(parsed.httpStatus).toBe(404);
      expect(parsed.isDomain).toBe(true);
      expect(parsed.meta).toEqual({ id: "ds_1" });
    });

    it("falls back to the code when the server authored no prose", () => {
      // `CliDomainError.message` is non-optional, so it degrades to the code
      // rather than inventing a sentence. The handled error's own message is
      // server copy and never reaches us (ADR-045); prose only arrives when the
      // server put it in `meta.message`.
      expect(parseDomainError({ status: 404, body: versioned() }).message).toBe(
        "dataset_not_found",
      );
    });

    it("prefers server-authored prose from meta.message", () => {
      const parsed = parseDomainError({
        status: 404,
        body: versioned({
          meta: { id: "ds_1", message: "That dataset was deleted." },
        }),
      });

      expect(parsed.message).toBe("That dataset was deleted.");
    });

    it("resolves the discriminant from type alone when code is absent", () => {
      // Go emits `type` (OpenAI-compatible); both names carry the same value.
      const { code: _dropped, kind: _alsoDropped, ...typeOnly } = versioned();

      expect(parseDomainError({ status: 404, body: typeOnly }).kind).toBe("dataset_not_found");
    });
  });

  describe("given the legacy flat body", () => {
    it("still reads the kind from error and the sentence from message", () => {
      const parsed = parseDomainError({
        status: 403,
        body: {
          error: "lite_member_restricted",
          message: "You need a full seat.",
        },
      });

      expect(parsed.kind).toBe("lite_member_restricted");
      expect(parsed.message).toBe("You need a full seat.");
      expect(parsed.isDomain).toBe(true);
    });
  });

  describe("given a server failure", () => {
    it("is not treated as a domain error the user caused", () => {
      const parsed = parseDomainError({
        status: 500,
        body: { code: "internal_error", message: "internal_error", meta: {} },
      });

      expect(parsed.isDomain).toBe(false);
    });
  });
});
