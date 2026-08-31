/**
 * The process policy wrapped around the package-owned role and role-binding
 * transports. Role definition and assignment is a privilege-escalation
 * surface — whoever writes roles writes their own permissions — so the proof
 * this file carries is that the move changed nothing a caller can observe:
 * the same procedure names, the same declared access decision on each one,
 * and the same denial shape when the decision refuses.
 *
 * @vitest-environment node
 */
import { type AuthzDeclaration, authzDeclarationOf } from "@langwatch/authz-contract";
import type { Role } from "@langwatch/role-contract";
import { RoleApp, type RoleAppDependencies } from "@langwatch/role-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppAuditLogRuntime } from "~/runtime/app/features/audit-log";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { roleRouter } from "../role.router";
import { roleBindingRouter } from "../role-binding.router";

const ORGANIZATION_ID = "organization_role_mount";
const ROLE_ID = "role_mount";

const role: Role = {
  id: ROLE_ID,
  organizationId: ORGANIZATION_ID,
  name: "Reviewer",
  description: null,
  permissions: ["traces:view"],
  kind: "custom",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function declarationsOf(router: unknown): Record<string, AuthzDeclaration | null> {
  const procedures = (router as { _def: { procedures: Record<string, unknown> } })._def.procedures;

  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => {
      const middlewares = (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares;
      const declaration =
        (middlewares ?? [])
          .map((middleware) => authzDeclarationOf(middleware))
          .find((found) => found !== null) ?? null;
      return [path, declaration];
    }),
  );
}

function buildContext({
  permitted,
  session = { user: { id: "user_role_mount" }, expires: "1" },
}: {
  permitted: boolean;
  session?: { user: { id: string }; expires: string } | null;
}) {
  const listed: Array<{ organizationId: string }> = [];
  const permissions = {
    checkScopeLineage: async () => ({ kind: "consistent" as const }),
    getDecision: async () => ({
      permitted,
      organizationRole: null,
      denialReason: permitted ? undefined : ("no-binding" as const),
    }),
  };
  // The REAL `RoleApp` over a stubbed service: the mounted procedures read
  // `app.roles.listRoles` / `getRole`, which is the application's surface, and
  // a hand-written double in its place would be asserting the mount against a
  // shape production does not have.
  const roles = RoleApp.create({
    roles: {
      list: async (input: { organizationId: string }) => {
        listed.push(input);
        return [role];
      },
      get: async () => role,
    },
  } as unknown as RoleAppDependencies);
  // Only the two services the mounted chain actually reaches. The composed
  // test App is deliberately not used: it would drag every unrelated runtime
  // into a test about who may call these seven procedures.
  const app = { permissions, roles } as unknown as RequestAppServices;

  return {
    listed,
    context: createInnerTRPCContext({
      app,
      session,
      permissionChecked: false,
      publiclyShared: false,
    }),
  };
}

const auditRows: unknown[] = [];

describe("role transport mount", () => {
  // A refused call is audited, and the audit sink is a process singleton the
  // composition root installs. Collect the rows rather than reach a database.
  beforeAll(() => {
    AppAuditLogRuntime.install({
      prisma: { auditLog: { create: async (row: unknown) => auditRows.push(row) } },
    });
  });
  afterAll(() => {
    AppAuditLogRuntime.clear();
  });

  describe("given the composed routers", () => {
    /** @scenario "The role transport moves without changing who may call it" */
    it("keeps the legacy role procedure names the browser calls", () => {
      const procedures = (
        roleRouter as unknown as { _def: { procedures: Record<string, unknown> } }
      )._def.procedures;

      expect(Object.keys(procedures).sort()).toEqual([
        "assignToUser",
        "create",
        "delete",
        "getAll",
        "getById",
        "removeFromUser",
        "update",
      ]);
    });

    /** @scenario "The role transport moves without changing who may call it" */
    it("keeps the legacy role binding procedure names the browser calls", () => {
      const procedures = (
        roleBindingRouter as unknown as { _def: { procedures: Record<string, unknown> } }
      )._def.procedures;

      expect(Object.keys(procedures).sort()).toEqual([
        "applyMemberBindings",
        "create",
        "delete",
        "getMyAccessBreakdown",
        "listForOrg",
        "listForUser",
        "update",
      ]);
    });

    /** @scenario "The role transport moves without changing who may call it" */
    it("declares the same access decision on every role procedure", () => {
      expect(declarationsOf(roleRouter)).toEqual({
        getAll: { kind: "permission", permission: "organization:manage", via: undefined },
        getById: {
          kind: "custom",
          reason: "the role's organization is loaded by its id; the check runs there",
          permissions: ["organization:view"],
        },
        create: { kind: "permission", permission: "organization:manage", via: undefined },
        update: {
          kind: "custom",
          reason: "the role's organization is loaded by its id; the check runs there",
          permissions: ["organization:manage"],
        },
        delete: {
          kind: "custom",
          reason: "the role's organization is loaded by its id; the check runs there",
          permissions: ["organization:manage"],
        },
        assignToUser: { kind: "permission", permission: "organization:manage", via: "teamId" },
        removeFromUser: { kind: "permission", permission: "organization:manage", via: "teamId" },
      });
    });

    /** @scenario "The role transport moves without changing who may call it" */
    it("declares the same access decision on every role binding procedure", () => {
      expect(declarationsOf(roleBindingRouter)).toEqual({
        listForOrg: { kind: "permission", permission: "organization:manage", via: undefined },
        listForUser: { kind: "permission", permission: "organization:manage", via: undefined },
        getMyAccessBreakdown: {
          kind: "permission",
          permission: "organization:view",
          via: undefined,
        },
        create: { kind: "permission", permission: "organization:manage", via: undefined },
        update: { kind: "permission", permission: "organization:manage", via: undefined },
        delete: { kind: "permission", permission: "organization:manage", via: undefined },
        applyMemberBindings: {
          kind: "permission",
          permission: "organization:manage",
          via: undefined,
        },
      });
    });
  });

  describe("when the caller has no session", () => {
    it("refuses the role surface before the service runs", async () => {
      const { context } = buildContext({ permitted: true, session: null });

      await expect(
        roleRouter.createCaller(context).getAll({ organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses the role binding surface before the service runs", async () => {
      const { context } = buildContext({ permitted: true, session: null });

      await expect(
        roleBindingRouter.createCaller(context).listForOrg({ organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("when the organization decision refuses", () => {
    /** @scenario "A caller the organization decision refuses reaches no role data" */
    it("answers with the engine's one denial code and a forbidden status", async () => {
      const { context, listed } = buildContext({ permitted: false });

      await expect(
        roleRouter.createCaller(context).getAll({ organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "permission_denied" },
      });
      expect(listed).toEqual([]);
    });
  });

  describe("when the organization decision permits", () => {
    it("delegates the read to the canonical Role service", async () => {
      const { context, listed } = buildContext({ permitted: true });

      await expect(
        roleRouter.createCaller(context).getAll({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual([role]);
      expect(listed).toEqual([{ organizationId: ORGANIZATION_ID }]);
    });

    it("loads a role by id through the service the custom check already used", async () => {
      const { context } = buildContext({ permitted: true });

      await expect(roleRouter.createCaller(context).getById({ roleId: ROLE_ID })).resolves.toEqual(
        role,
      );
    });
  });
});
