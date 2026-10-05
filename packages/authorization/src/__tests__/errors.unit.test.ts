import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  BlankScopeIdError,
  DeveloperSeatRestrictedError,
  LiteMemberRestrictedError,
  PermissionDeniedError,
} from "../errors.ts";

describe("DeveloperSeatRestrictedError", () => {
  /** @scenario A Developer never sees a shared project */
  it("carries its own code, names the seat, and keeps the resource in meta", () => {
    const error = new DeveloperSeatRestrictedError("traces");
    expect(error.code).toBe("developer_seat_restricted");
    expect(error.message).toBe("This is outside your Developer seat");
    expect(error.httpStatus).toBe(401);
    expect(error.meta).toEqual({ resource: "traces" });
    expect(error.serialize()).toMatchObject({
      code: "developer_seat_restricted",
      meta: { resource: "traces" },
      httpStatus: 401,
    });
  });
});

describe("PermissionDeniedError", () => {
  describe("when the engine refused a Developer seat", () => {
    it("names the seat rather than a permission to ask for", () => {
      const error = new PermissionDeniedError({
        permission: "traces:view",
        scope: { type: "project", id: "project-1" },
        denialReason: "developer-restricted",
      });
      expect(error.code).toBe("permission_denied");
      expect(error.denialReason).toBe("developer-restricted");
      expect(error.message).toBe("This is outside your Developer seat");
    });
  });
});

describe("LiteMemberRestrictedError", () => {
  describe("when constructed with a resource", () => {
    it("sets code to lite_member_restricted", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.code).toBe("lite_member_restricted");
    });

    it("sets the user-facing message", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.message).toBe("This feature is not available for your account");
    });

    it("sets httpStatus to 401", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error.httpStatus).toBe(401);
    });

    it("stores the resource in meta", () => {
      const error = new LiteMemberRestrictedError("datasets");
      expect(error.meta).toEqual({ resource: "datasets" });
    });

    it("is an instance of HandledError", () => {
      const error = new LiteMemberRestrictedError("prompts");
      expect(error).toBeInstanceOf(HandledError);
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
        code: "lite_member_restricted",
        meta: { resource: "evaluations" },
        httpStatus: 401,
        reasons: [],
      });
    });

    it("emits the deprecated `kind` alias equal to `code` for back-compat", () => {
      const error = new LiteMemberRestrictedError("evaluations");
      const serialized = error.serialize();

      expect(serialized.kind).toBe("lite_member_restricted");
      expect(serialized.kind).toBe(serialized.code);
    });
  });
});

describe("BlankScopeIdError", () => {
  it("keeps blank scope ids in the established customer-correctable error envelope", () => {
    const error = new BlankScopeIdError({ field: "projectId" });

    expect(error).toMatchObject({
      code: "validation_error",
      message: "The request did not name a scope to act in.",
      fault: "customer",
      httpStatus: 400,
      meta: { fieldErrors: { projectId: ["Required"] } },
    });
  });
});
