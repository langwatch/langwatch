/**
 * The Enterprise plan gate the process wraps around the package-owned `role.*` transport.
 */
import {
  authzDeclarationOf,
  declareAuthzMiddleware,
  PermissionDeniedError,
  type AuthzDeclaration,
} from "@langwatch/authz-contract";
import {
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
} from "@langwatch/enterprise-plan-gate";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { Role, RoleService } from "@langwatch/role-contract";
import { RoleApp, type RoleTrpcContext } from "@langwatch/role-server";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRoleTrpcRouter } from "../role-trpc.mount.ts";

const ORGANIZATION_ID = "organization_role_mount";
const USER_ID = "user_role_mount";

const role: Role = {
  id: "role_1",
  organizationId: ORGANIZATION_ID,
  name: "Reviewer",
  description: null,
  permissions: ["analytics:view"],
  kind: "custom",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/**
 * Pass-through stand-ins for the process's own policy chain. `enforceCheck` is
 * the one the process fails a refused caller on, so a refusal test replaces it.
 */
function passThroughMiddlewares(
  enforceCheck?: (params: { next: () => Promise<unknown> }) => Promise<unknown>,
): AppTrpcPolicyMiddlewares {
  const passThrough = ({ next }: { next: () => Promise<unknown> }) => next();
  return {
    tracer: passThrough,
    logger: passThrough,
    handledError: passThrough,
    scopeLineageGuard: () => passThrough,
    declaredCheck: (declaration: AuthzDeclaration) =>
      declareAuthzMiddleware(
        declaration,
        passThrough as unknown as (params: never) => Promise<unknown>,
      ),
    enforceCheck: enforceCheck ?? passThrough,
    auditMutations: passThrough,
  };
}

/**
 * @param planType the plan the deployment resolves for this organization. The
 *   gate is the real one, so a test states the plan rather than the refusal.
 */
function harness({
  planType,
  organizationDecision = "allow",
}: {
  planType: string;
  organizationDecision?: "allow" | "refuse";
}) {
  const roles = {
    list: vi.fn(async () => [role]),
    get: vi.fn(async () => role),
    create: vi.fn(async () => role),
    update: vi.fn(async () => role),
    remove: vi.fn(async () => ({ success: true as const })),
    assignToUser: vi.fn(async () => ({ success: true as const })),
    removeFromUser: vi.fn(async () => ({ success: true as const })),
    getAssignmentOrganization: vi.fn(async () => ORGANIZATION_ID),
  };

  const assertCustomRolePlan = vi.fn(async () => {
    assertEnterprisePlanType({ planType, errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC });
  });

  const trpc = initTRPC.context<RoleTrpcContext>().create();
  const router = createRoleTrpcRouter({
    root: trpc,
    protectedProcedure: trpc.procedure,
    middlewares: passThroughMiddlewares(
      organizationDecision === "refuse"
        ? () =>
            Promise.reject(
              new PermissionDeniedError({
                permission: "organization:manage",
                scope: { type: "organization", id: ORGANIZATION_ID },
                denialReason: "no-binding",
              }),
            )
        : undefined,
    ),
    ports: {
      probeOrganizationPermission: async () => organizationDecision === "allow",
      assertCustomRolePlan,
      customRolePermission: z.string(),
    },
  });

  return {
    roles,
    router,
    assertCustomRolePlan,
    caller: router.createCaller({
      app: {
        roles: RoleApp.create({
          roles: roles as unknown as RoleService,
          permissions: {} as AuthzService,
          authzGrants: {} as AuthzGrantsService,
        }),
      },
      actor: () => ({ id: USER_ID }),
    }),
  };
}

describe("the role transport mount", () => {
  describe("given an organization whose plan is not ENTERPRISE", () => {
    describe("when an administrator defines a custom role", () => {
      /** @scenario "Non-enterprise org cannot create custom roles" */
      it("refuses before the role service is reached", async () => {
        const { caller, roles } = harness({ planType: "FREE" });

        await expect(
          caller.create({
            organizationId: ORGANIZATION_ID,
            name: "Reviewer",
            permissions: ["analytics:view"],
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(roles.create).not.toHaveBeenCalled();
      });
    });

    describe("when an administrator rewrites a custom role", () => {
      /** @scenario "Non-enterprise org cannot update custom roles" */
      it("refuses before the role service is reached", async () => {
        const { caller, roles } = harness({ planType: "FREE" });

        await expect(caller.update({ roleId: role.id, name: "Auditor" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(roles.update).not.toHaveBeenCalled();
      });
    });

    describe("when an administrator hands a custom role to a team member", () => {
      /** @scenario "Non-enterprise org cannot assign custom roles to users" */
      it("refuses before the assignment is written", async () => {
        const { caller, roles } = harness({ planType: "FREE" });

        await expect(
          caller.assignToUser({ userId: "user_2", teamId: "team_1", customRoleId: role.id }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(roles.assignToUser).not.toHaveBeenCalled();
      });
    });

    describe("when an administrator takes a custom role away again", () => {
      /** @scenario "Non-enterprise org can remove custom roles from users" */
      it("removes it without consulting the plan", async () => {
        const { caller, roles, assertCustomRolePlan } = harness({ planType: "FREE" });

        await expect(
          caller.removeFromUser({ userId: "user_2", teamId: "team_1", customRoleId: role.id }),
        ).resolves.toEqual({ success: true });
        expect(roles.removeFromUser).toHaveBeenCalled();
        expect(assertCustomRolePlan).not.toHaveBeenCalled();
      });
    });

    describe("when an administrator deletes a custom role left over from Enterprise", () => {
      /** @scenario "Non-enterprise org can delete custom roles for cleanup" */
      it("deletes it without consulting the plan", async () => {
        const { caller, roles, assertCustomRolePlan } = harness({ planType: "FREE" });

        await expect(caller.delete({ roleId: role.id })).resolves.toEqual({ success: true });
        expect(roles.remove).toHaveBeenCalled();
        expect(assertCustomRolePlan).not.toHaveBeenCalled();
      });
    });

    describe("when a member reads one custom role", () => {
      /** @scenario "Non-enterprise org can view a custom role" */
      it("answers with the role details", async () => {
        const { caller, assertCustomRolePlan } = harness({ planType: "FREE" });

        await expect(caller.getById({ roleId: role.id })).resolves.toEqual(role);
        expect(assertCustomRolePlan).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an organization on the ENTERPRISE plan", () => {
    describe("when an administrator defines a custom role", () => {
      /** @scenario "Enterprise org can create custom roles" */
      it("creates it", async () => {
        const { caller, roles } = harness({ planType: "ENTERPRISE" });

        await expect(
          caller.create({
            organizationId: ORGANIZATION_ID,
            name: "Reviewer",
            permissions: ["analytics:view"],
          }),
        ).resolves.toEqual(role);
        expect(roles.create).toHaveBeenCalled();
      });
    });
  });
});

/** The names the browser calls, and what each one claims before it runs. */
const PUBLISHED_PROCEDURES = [
  "getAll",
  "getById",
  "create",
  "update",
  "delete",
  "assignToUser",
  "removeFromUser",
] as const;

/** The permissions a declaration claims, whichever declared shape it holds. */
function claimedPermissions(declaration: AuthzDeclaration | null | undefined): readonly string[] {
  if (declaration?.kind === "permission") return [declaration.permission];
  if (declaration && "permissions" in declaration) return declaration.permissions;
  return [];
}

function declarationsOf(router: unknown): Record<string, AuthzDeclaration | null> {
  const procedures = (router as { _def: { procedures: Record<string, unknown> } })._def.procedures;

  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => {
      const middlewares =
        (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ?? [];
      const declared =
        middlewares.map((middleware) => authzDeclarationOf(middleware)).find((f) => f !== null) ??
        null;
      return [path, declared];
    }),
  );
}

describe("given the role transport mounted on the process's own tRPC root", () => {
  describe("when the browser calls it", () => {
    /** @scenario The role transport moves without changing who may call it */
    it("publishes the same procedure names, each with its access decision declared", () => {
      const { router } = harness({ planType: "ENTERPRISE" });

      const declarations = declarationsOf(router);

      expect(Object.keys(declarations).sort()).toEqual([...PUBLISHED_PROCEDURES].sort());
      for (const name of PUBLISHED_PROCEDURES) {
        const declaration = declarations[name];
        const claimed = claimedPermissions(declaration);
        expect(claimed).toContain(name === "getById" ? "organization:view" : "organization:manage");
      }
    });
  });

  describe("when the organization decision refuses the caller", () => {
    /** @scenario A caller the organization decision refuses reaches no role data */
    it("refuses with the permission-denied code without reaching the role service", async () => {
      const { caller, roles } = harness({
        planType: "ENTERPRISE",
        organizationDecision: "refuse",
      });

      await expect(caller.getAll({ organizationId: ORGANIZATION_ID })).rejects.toMatchObject({
        cause: { code: "permission_denied", httpStatus: 403 },
      });
      expect(roles.list).not.toHaveBeenCalled();
    });
  });
});
