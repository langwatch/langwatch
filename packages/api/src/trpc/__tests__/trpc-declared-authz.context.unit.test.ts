/** @vitest-environment node */

/**
 * What a declared check leaves behind on the request context, and what it
 * refuses to look at. The legacy middlewares carried the caller's
 * organization role forward for every project and team resolution and left it
 * unset at organization scope; downstream resolvers still read it, so the
 * carry is behaviour rather than bookkeeping.
 * Spec: packages/features/authz/specs/permission-resolution.feature
 */
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
  PermissionDecision,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import {
  createDeclaredAuthzMiddlewares,
  type TrpcDeclaredAuthzContext,
  type TrpcDeclaredAuthzPorts,
} from "../trpc-declared-authz.ts";
import type { TrpcMiddlewareContext } from "../trpc-policy-ports.ts";

type GetDecision = ReturnType<
  typeof vi.fn<(input: AuthzGetDecisionInput) => Promise<PermissionDecision>>
>;

function makePorts({
  actorId,
  getDecision,
}: {
  actorId: string | undefined;
  getDecision: GetDecision;
}): TrpcDeclaredAuthzPorts<TrpcDeclaredAuthzContext> {
  return {
    identity: { actor: () => (actorId ? { id: actorId } : undefined) },
    authorization: {
      forRequest: () => ({
        getDecision,
        getProjectAnyDecision: vi.fn(),
        checkScopeLineage:
          vi.fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>(),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: (resource: string) => new Error(`lite member: ${resource}`),
    },
  };
}

const ctxFor = (): TrpcMiddlewareContext<TrpcDeclaredAuthzContext> => ({
  permissionChecked: false,
  organizationRole: undefined,
});

describe("given a declared permission check", () => {
  describe("when no session backs the request", () => {
    /** @scenario "An unauthenticated caller is refused before any scope id is read" */
    it("refuses without asking for a decision or reading the scope id", async () => {
      const getDecision: GetDecision = vi.fn();
      const checks = createDeclaredAuthzMiddlewares(makePorts({ actorId: undefined, getDecision }));
      const ctx = ctxFor();
      const next = vi.fn();

      const error = await checks
        .permission({ permission: "traces:view" })({
          ctx,
          input: { projectId: "proj-1" },
          next,
        })
        .catch((thrown: unknown) => thrown as TRPCError);

      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("UNAUTHORIZED");
      expect(getDecision).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(ctx.permissionChecked).toBe(false);
    });
  });

  describe("when the decision names the caller's organization role", () => {
    /** @scenario "A permitted decision carries the organization role onto the request" */
    it("carries it onto the context for the resolver behind the check", async () => {
      const getDecision: GetDecision = vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: "EXTERNAL" });
      const checks = createDeclaredAuthzMiddlewares(makePorts({ actorId: "alice", getDecision }));
      const ctx = ctxFor();

      await checks.permission({ permission: "traces:view" })({
        ctx,
        input: { projectId: "proj-1" },
        next: vi.fn(),
      });

      expect(ctx.organizationRole).toBe("EXTERNAL");
      expect(ctx.permissionChecked).toBe(true);
    });
  });

  describe("when the decision reports no organization role", () => {
    /** @scenario "A permitted decision carries the organization role onto the request" */
    it("leaves the context's role untouched, as the organization tier always did", async () => {
      const getDecision: GetDecision = vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: null });
      const checks = createDeclaredAuthzMiddlewares(makePorts({ actorId: "alice", getDecision }));
      const ctx = ctxFor();

      await checks.permission({ permission: "organization:view" })({
        ctx,
        input: { organizationId: "org-1" },
        next: vi.fn(),
      });

      expect(ctx.organizationRole).toBeUndefined();
      expect(ctx.permissionChecked).toBe(true);
    });
  });

  describe("when the caller is denied", () => {
    /** @scenario "A denied request is never marked as checked" */
    it("never marks the request as checked, so the backstop still refuses it", async () => {
      const getDecision: GetDecision = vi
        .fn()
        .mockResolvedValue({ permitted: false, organizationRole: "MEMBER" });
      const checks = createDeclaredAuthzMiddlewares(makePorts({ actorId: "alice", getDecision }));
      const ctx = ctxFor();
      const next = vi.fn();

      await expect(
        checks.permission({ permission: "datasets:manage" })({
          ctx,
          input: { projectId: "proj-1" },
          next,
        }),
      ).rejects.toBeInstanceOf(TRPCError);

      expect(ctx.permissionChecked).toBe(false);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
