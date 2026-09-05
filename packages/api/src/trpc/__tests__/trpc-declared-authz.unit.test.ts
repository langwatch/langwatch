/** @vitest-environment node */

/**
 * The declared-check seam's own behaviour, over the ports interface: which decision each builder asks for, what an
 * unauthenticated or miswired call gets, and the SHAPE of a refusal. The authorization port is a bare mock here —
 * the engine's own decisions are `authz-service.facade.unit.test.ts`'s business.
 */
import {
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzScopeLineageInput,
  authzDeclarationOf,
  BlankScopeIdError,
  type AuthzScopeLineageResult,
  type PermissionDecision,
  PermissionDeniedError,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcAuthorizationDecisions, TrpcMiddlewareContext } from "../trpc-policy-ports.js";
import {
  createDeclaredAuthzMiddlewares,
  type TrpcDeclaredAuthzContext,
  type TrpcDeclaredAuthzPorts,
} from "../trpc-declared-authz.js";

function makePorts({
  actorId = "alice",
  getDecision = vi
    .fn<(input: AuthzGetDecisionInput) => Promise<PermissionDecision>>()
    .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  getProjectAnyDecision = vi
    .fn<(input: AuthzGetProjectAnyDecisionInput) => Promise<PermissionDecision>>()
    .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
}: {
  actorId?: string | undefined;
  getDecision?: ReturnType<
    typeof vi.fn<(input: AuthzGetDecisionInput) => Promise<PermissionDecision>>
  >;
  getProjectAnyDecision?: ReturnType<
    typeof vi.fn<(input: AuthzGetProjectAnyDecisionInput) => Promise<PermissionDecision>>
  >;
} = {}): TrpcDeclaredAuthzPorts<TrpcDeclaredAuthzContext> & {
  decisions: TrpcAuthorizationDecisions;
} {
  const checkScopeLineage =
    vi.fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>();
  const decisions: TrpcAuthorizationDecisions = {
    getDecision,
    getProjectAnyDecision,
    checkScopeLineage,
  };
  return {
    identity: { actor: () => (actorId ? { id: actorId } : undefined) },
    authorization: { forRequest: () => decisions },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: (resource: string) => new Error(`lite member: ${resource}`),
    },
    decisions,
  };
}

function ctxFor(): TrpcMiddlewareContext<TrpcDeclaredAuthzContext> {
  return { permissionChecked: false, organizationRole: undefined };
}

const rejection = async (run: () => Promise<unknown>): Promise<TRPCError> => {
  try {
    await run();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected the middleware to throw");
};

describe("createDeclaredAuthzMiddlewares", () => {
  describe(".permission", () => {
    describe("given the request context carries its own authorization decisions", () => {
      /** @scenario "Every grant check decides through the App the request context carries" */
      it("resolves the decision through the port's forRequest, never a module-level singleton", async () => {
        const ports = makePorts();
        const checks = createDeclaredAuthzMiddlewares(ports);
        const ctx = ctxFor();
        const next = vi.fn().mockReturnValue("next-called");

        await checks.permission({ permission: "traces:view" })({
          ctx,
          input: { projectId: "proj-1" },
          next,
        });

        expect(ports.decisions.getDecision).toHaveBeenCalledWith({
          userId: "alice",
          permission: "traces:view",
          scope: { tier: "project", id: "proj-1" },
        });
        expect(ctx.permissionChecked).toBe(true);
        expect(next).toHaveBeenCalled();
      });
    });

    describe("when the caller is denied", () => {
      /** @scenario "A denial carries a stable code the client can present" */
      it("refuses with the one handled code, naming the permission and tier", async () => {
        const ports = makePorts({
          getDecision: vi.fn().mockResolvedValue({ permitted: false, organizationRole: "MEMBER" }),
        });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const error = await rejection(() =>
          checks.permission({ permission: "traces:view" })({
            ctx: ctxFor(),
            input: { projectId: "proj-1" },
            next: vi.fn(),
          }),
        );
        expect(error.cause).toBeInstanceOf(PermissionDeniedError);
        const cause = error.cause as PermissionDeniedError;
        expect(cause.code).toBe("permission_denied");
        expect(cause.meta).toMatchObject({ permission: "traces:view", scopeType: "project" });
      });

      /** @scenario "A scope id that resolves to nothing is denied like one the caller may not touch" */
      it("answers an unknown id identically to a denied one, revealing nothing about it", async () => {
        const ports = makePorts({
          getDecision: vi.fn().mockResolvedValue({ permitted: false, organizationRole: null }),
        });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const error = await rejection(() =>
          checks.permission({ permission: "traces:view" })({
            ctx: ctxFor(),
            input: { projectId: "does-not-exist" },
            next: vi.fn(),
          }),
        );
        expect((error.cause as PermissionDeniedError).code).toBe("permission_denied");
        expect(error.message).not.toContain("does-not-exist");
      });

      /** @scenario "A lite member's denial is distinguishable from a missing grant" */
      it("carries the lite-member restriction for an EXTERNAL caller", async () => {
        const ports = makePorts({
          getDecision: vi
            .fn()
            .mockResolvedValue({ permitted: false, organizationRole: "EXTERNAL" }),
        });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const error = await rejection(() =>
          checks.permission({ permission: "team:manage" })({
            ctx: ctxFor(),
            input: { teamId: "team-1" },
            next: vi.fn(),
          }),
        );
        expect((error.cause as Error).message).toContain("lite member");
      });
    });
  });

  describe(".permissionAny", () => {
    /** @scenario "Any one of several declared permissions is enough" */
    it("permits on the resolver's any-of answer and names the first permission when denied", async () => {
      const ports = makePorts();
      const checks = createDeclaredAuthzMiddlewares(ports);
      const ctx = ctxFor();

      await checks.permissionAny(["traces:view", "scenarios:view"])({
        ctx,
        input: { projectId: "proj-1" },
        next: vi.fn().mockReturnValue("next-called"),
      });
      expect(ports.decisions.getProjectAnyDecision).toHaveBeenCalledWith({
        userId: "alice",
        projectId: "proj-1",
        permissions: ["traces:view", "scenarios:view"],
      });
      expect(ctx.permissionChecked).toBe(true);

      const denyingPorts = makePorts({
        getProjectAnyDecision: vi
          .fn()
          .mockResolvedValue({ permitted: false, organizationRole: "MEMBER" }),
      });
      const denyingChecks = createDeclaredAuthzMiddlewares(denyingPorts);
      const error = await rejection(() =>
        denyingChecks.permissionAny(["traces:view", "scenarios:view"])({
          ctx: ctxFor(),
          input: { projectId: "proj-1" },
          next: vi.fn(),
        }),
      );
      expect((error.cause as PermissionDeniedError).meta).toMatchObject({
        permission: "traces:view",
      });
    });

    /** @scenario "A blank project id on a multi-permission check is answered the same way" */
    it("answers a blank project id as invalid input, not an internal error", async () => {
      const ports = makePorts();
      const checks = createDeclaredAuthzMiddlewares(ports);
      const error = await rejection(() =>
        checks.permissionAny(["traces:view", "scenarios:view"])({
          ctx: ctxFor(),
          input: { projectId: "" },
          next: vi.fn(),
        }),
      );
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.cause).toBeInstanceOf(BlankScopeIdError);
      expect(ports.decisions.getProjectAnyDecision).not.toHaveBeenCalled();
    });
  });

  describe(".noPermission", () => {
    /** @scenario "Opting out of permission checks requires a written reason" */
    it("runs for any authenticated caller and records its reason in the declaration", async () => {
      const checks = createDeclaredAuthzMiddlewares(makePorts());
      const middleware = checks.noPermission({ reason: "user-scoped preferences only" });
      const ctx = ctxFor();
      await middleware({ ctx, input: {}, next: vi.fn().mockReturnValue("next-called") });
      expect(ctx.permissionChecked).toBe(true);
      expect(authzDeclarationOf(middleware)).toMatchObject({
        kind: "no-permission",
        reason: "user-scoped preferences only",
      });
    });

    /** @scenario "An opted-out procedure cannot silently read scoped input" */
    it("still refuses an unallowed scope id at runtime, defense in depth", async () => {
      const checks = createDeclaredAuthzMiddlewares(makePorts());
      const middleware = checks.noPermission({ reason: "nothing scoped" });
      await expect(
        middleware({ ctx: ctxFor(), input: { projectId: "proj-1" }, next: vi.fn() }),
      ).rejects.toThrow("projectId is not allowed");

      const allowed = checks.noPermission({
        reason: "creation flow",
        allow: { organizationId: "creating inside this organization" },
      });
      await expect(
        allowed({
          ctx: ctxFor(),
          input: { organizationId: "org-1" },
          next: vi.fn().mockReturnValue("next-called"),
        }),
      ).resolves.toBe("next-called");
    });
  });

  describe(".serviceAuthorized", () => {
    /** @scenario "A service-authorized procedure declares the permissions its service enforces" */
    it("marks the check as deferred and names the enforced permissions", async () => {
      const checks = createDeclaredAuthzMiddlewares(makePorts());
      const middleware = checks.serviceAuthorized({
        reason: "the row's own scope set decides",
        permissions: ["traces:view"],
      });
      const ctx = ctxFor();
      await middleware({ ctx, next: vi.fn().mockReturnValue("next-called") });
      expect(ctx.permissionChecked).toBe(true);
      expect(authzDeclarationOf(middleware)).toMatchObject({
        kind: "service-authorized",
        permissions: ["traces:view"],
      });
    });
  });
});
