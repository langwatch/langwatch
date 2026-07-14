import { describe, expect, it } from "vitest";
import { LiteMemberRestrictedError } from "../errors";
import { DomainError } from "../../domain-error";

describe("LiteMemberRestrictedError", () => {
  describe("when constructed with a resource", () => {
    it("sets kind to lite_member_restricted", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.kind).toBe("lite_member_restricted");
    });

    it("sets the user-facing message", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.message).toBe(
        "This feature is not available for your account",
      );
    });

    it("sets httpStatus to 401", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.httpStatus).toBe(401);
    });

    it("stores the resource in meta", () => {
      const error = new LiteMemberRestrictedError("datasets");
      expect(error.meta).toEqual({ resource: "datasets" });
    });

    it("is an instance of DomainError", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error).toBeInstanceOf(DomainError);
    });

    it("sets name to LiteMemberRestrictedError", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.name).toBe("LiteMemberRestrictedError");
    });
  });

  describe("when serialized", () => {
    it("produces the expected shape", () => {
      const error = new LiteMemberRestrictedError("evaluations");
      const serialized = error.serialize();

      expect(serialized).toMatchObject({
        kind: "lite_member_restricted",
        meta: { resource: "evaluations" },
        httpStatus: 401,
        reasons: [],
      });
    });
  });
});
