/** @vitest-environment node */

/**
 * The tRPC adapter's own behaviour: the DECLARED scope contract, what an
 * unauthenticated or miswired call gets, and the SHAPE of a refusal. The
 * engine's verdicts are @langwatch/authz's business and are stubbed here.
 *
 * The refusal shape is the sharp part. An unknown id and a denied id have to
 * come out identical: when the unknown branch answered with a bare
 * "UNAUTHORIZED" and no error code, it told an outsider whether an id EXISTS,
 * and left the client rendering "unknown error" for a denial it could have
 * named.
 */
import { PermissionDeniedError } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LiteMemberRestrictedError } from "~/server/app-layer/permissions/errors";

const checkDetailed = vi.fn();
const resolveScopeRef = vi.fn();

vi.mock("~/server/authz/runtime", () => ({
  authz: {
    checkDetailed: (...args: unknown[]) => checkDetailed(...args),
  },
  authzCollector: {
    resolveScopeRef: (...args: unknown[]) => resolveScopeRef(...args),
  },
}));

const { checkPermissionV2 } = await import("../trpc-middleware");

const PROJECT_SCOPE = {
  type: "project" as const,
  id: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
};

const session = { user: { id: "alice" } };

const paramsFor = (input: Record<string, string | undefined>) => ({
  ctx: {
    session: session as any,
    permissionChecked: false,
    organizationRole: undefined as "ADMIN" | "MEMBER" | "EXTERNAL" | undefined,
  },
  input,
  next: vi.fn().mockReturnValue("next-called"),
});

/** The caught error, always — `rejects` alone would not let us read `cause`. */
const rejection = async (run: () => Promise<unknown>): Promise<TRPCError> => {
  try {
    await run();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected the middleware to throw");
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveScopeRef.mockResolvedValue(PROJECT_SCOPE);
  checkDetailed.mockResolvedValue({
    decision: { allowed: true },
    grants: { organizationRole: "MEMBER" },
  });
});

describe("checkPermissionV2", () => {
  describe("given a gate declaring project scope and input carrying every id", () => {
    /** @scenario "A procedure declares which scope its permission gate reads" */
    it("resolves exactly the declared id and never consults the wider ones", async () => {
      const params = paramsFor({
        projectId: "proj-1",
        teamId: "team-9",
        organizationId: "org-9",
      });

      await checkPermissionV2("prompts:update", { scope: "project" })(params);

      expect(resolveScopeRef).toHaveBeenCalledTimes(1);
      expect(resolveScopeRef).toHaveBeenCalledWith({ projectId: "proj-1" });
    });
  });

  describe("given a gate declaring team scope", () => {
    it("reads the team id even when a wider organization id is present", async () => {
      resolveScopeRef.mockResolvedValue({
        type: "team",
        id: "team-1",
        organizationId: "org-1",
      });

      await checkPermissionV2("prompts:update", { scope: "team" })(
        paramsFor({ teamId: "team-1", organizationId: "org-1" }),
      );

      expect(resolveScopeRef).toHaveBeenCalledWith({ teamId: "team-1" });
    });
  });

  describe("given a gate declaring organization scope", () => {
    it("reads the organization id", async () => {
      resolveScopeRef.mockResolvedValue({ type: "organization", id: "org-1" });

      await checkPermissionV2("organization:manage", {
        scope: "organization",
      })(paramsFor({ organizationId: "org-1" }));

      expect(resolveScopeRef).toHaveBeenCalledWith({ organizationId: "org-1" });
    });
  });

  describe("given no session", () => {
    it("refuses as unauthenticated before any id is looked at", async () => {
      const params = paramsFor({ projectId: "proj-1" });
      params.ctx.session = null as any;

      const error = await rejection(() =>
        checkPermissionV2("prompts:update", { scope: "project" })(params),
      );

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe("UNAUTHORIZED");
      expect(resolveScopeRef).not.toHaveBeenCalled();
      expect(params.next).not.toHaveBeenCalled();
    });
  });

  describe("given input carrying only ids for scopes the gate did not declare", () => {
    /** @scenario "A declared scope with no matching id in the input fails as a wiring bug" */
    it("fails as a wiring bug before reading any grants, promising the caller nothing", async () => {
      const error = await rejection(() =>
        checkPermissionV2("prompts:update", { scope: "project" })(
          paramsFor({ teamId: "team-1", organizationId: "org-1" }),
        ),
      );

      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      // The permission name and the miswiring go to the log, not to the user.
      expect(error.message).not.toContain("prompts:update");
      expect(error.cause).toBeUndefined();
      expect(resolveScopeRef).not.toHaveBeenCalled();
      expect(checkDetailed).not.toHaveBeenCalled();
    });
  });

  describe("given a declared id the engine cannot resolve", () => {
    /** @scenario "An unknown scope id denies without revealing whether it exists" */
    it("denies exactly as an engine denial does, leaking no existence", async () => {
      resolveScopeRef.mockResolvedValue(null);
      const params = paramsFor({ projectId: "ghost" });

      const unknown = await rejection(() =>
        checkPermissionV2("prompts:update", { scope: "project" })(params),
      );

      checkDetailed.mockResolvedValue({
        decision: { allowed: false, denialReason: "no-binding" },
        grants: { organizationRole: "MEMBER" },
      });
      resolveScopeRef.mockResolvedValue(PROJECT_SCOPE);
      const denied = await rejection(() =>
        checkPermissionV2("prompts:update", { scope: "project" })(
          paramsFor({ projectId: "proj-1" }),
        ),
      );

      for (const error of [unknown, denied]) {
        expect(error.code).toBe("UNAUTHORIZED");
        expect(error.cause).toBeInstanceOf(PermissionDeniedError);
        expect(HandledError.isHandled(error.cause)).toBe(true);
        expect((error.cause as HandledError).code).toBe("permission_denied");
      }
      expect(unknown.message).toBe(denied.message);
      expect(params.next).not.toHaveBeenCalled();
    });

    it("names the tier the gate declared, so the denial is about that scope", async () => {
      resolveScopeRef.mockResolvedValue(null);

      const error = await rejection(() =>
        checkPermissionV2("team:manage", { scope: "team" })(
          paramsFor({ teamId: "ghost-team" }),
        ),
      );

      expect((error.cause as HandledError).meta).toMatchObject({
        scopeType: "team",
        denialReason: "no-membership",
      });
    });
  });

  describe("given the engine denies a lite member", () => {
    it("carries the restriction cause the client's modal keys on", async () => {
      checkDetailed.mockResolvedValue({
        decision: { allowed: false, denialReason: "lite-member-restricted" },
        grants: { organizationRole: "EXTERNAL" },
      });

      const error = await rejection(() =>
        checkPermissionV2("prompts:update", { scope: "project" })(
          paramsFor({ projectId: "proj-1" }),
        ),
      );

      expect(error.cause).toBeInstanceOf(LiteMemberRestrictedError);
      expect((error.cause as HandledError).code).toBe("lite_member_restricted");
      expect((error.cause as HandledError).meta).toMatchObject({
        resource: "prompts",
      });
    });
  });

  describe("given the engine allows the check", () => {
    it("hands the organization role to the context and records that a check ran", async () => {
      const params = paramsFor({ projectId: "proj-1" });

      const result = await checkPermissionV2("prompts:update", {
        scope: "project",
      })(params);

      expect(checkDetailed).toHaveBeenCalledWith({
        principal: { type: "user", id: "alice" },
        permission: "prompts:update",
        scope: PROJECT_SCOPE,
      });
      expect(params.ctx.organizationRole).toBe("MEMBER");
      expect(params.ctx.permissionChecked).toBe(true);
      expect(params.next).toHaveBeenCalledTimes(1);
      expect(result).toBe("next-called");
    });
  });
});
