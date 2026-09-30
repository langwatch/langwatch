import type { TrpcContractHandlerArguments, TrpcProcedureFactory } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The Roles & access page's `authz.*Grant*` procedures over the real grant management and
 * binding writer: the caller is always the session, never the input.
 * @see specs/rbac/roles-and-access-ui.feature
 */
import type {
  AuthzApi,
  AuthzManagedOrganizationBinding,
  AuthzPrincipalRef,
} from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { createAuthzTestApp } from "../../app/__tests__/authz.fixture.ts";
import type { AuthzCompatibilityLedger } from "../../app/authz.app.ts";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub.ts";
import { findPermissionsBeyondHeld } from "../../rules/grant-escalation.rules.ts";
import { AuthzBindingWriterService } from "../../services/authz-binding-writer.service.ts";
import { AuthzGrantManagementService } from "../../services/authz-grant-management.service.ts";
import { authzTrpcTransport } from "../authz.trpc.ts";

const ORG = "org-1";
const OTHER_ORG = "org-2";
/** A manager holding organization:manage through a narrow custom role, never admin. */
const MANAGER = "user-manager";
const HELD: Record<string, readonly string[]> = {
  [MANAGER]: ["organization:manage", "project:view"],
};
const SCOPES = [
  { type: "ORGANIZATION" as const, id: ORG, name: "Acme", personalWorkspaceName: null },
  { type: "TEAM" as const, id: "team-a", name: "Team A", personalWorkspaceName: null },
];

type Procedure = (input: unknown) => Promise<unknown>;

function row(
  over: Partial<AuthzManagedOrganizationBinding> & Pick<AuthzManagedOrganizationBinding, "id">,
): AuthzManagedOrganizationBinding {
  return {
    userId: null,
    userName: null,
    userEmail: null,
    userImage: null,
    groupId: null,
    groupName: null,
    groupScimSource: null,
    apiKeyId: null,
    apiKeyName: null,
    role: "MEMBER",
    customRoleId: null,
    customRoleName: null,
    scopeType: "TEAM",
    scopeId: "team-a",
    scopeName: "Team A",
    memberUserIds: [],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: null,
    ...over,
  };
}

/** The procedures bound as a process binds them, the session fixed to `sessionUserId`. */
function world({ sessionUserId = MANAGER }: { sessionUserId?: string } = {}) {
  const rows: AuthzManagedOrganizationBinding[] = [
    row({ id: "rb_own", userId: MANAGER, role: "CUSTOM", customRoleId: "customrole_ops" }),
    row({ id: "rb_other", userId: "user-2", role: "VIEWER" }),
  ];
  const foreignRows = [row({ id: "rb_foreign", userId: "user-foreign", role: "ADMIN" })];
  const callers: AuthzPrincipalRef[] = [];
  let next = 0;

  const bindings = new StubAuthzBindingRepository();
  bindings.findScopeRows.mockImplementation(async ({ scopes }) =>
    SCOPES.filter((scope) =>
      scopes.some((asked) => asked.scopeType === scope.type && asked.scopeId === scope.id),
    ),
  );
  bindings.findOrganizationRole.mockImplementation(async ({ userId }) =>
    [MANAGER, "user-2"].includes(userId) ? "MEMBER" : null,
  );
  bindings.findAssignableRoles.mockImplementation(async ({ roleIds }) =>
    [
      { id: "customrole_ops", permissions: ["project:view"] },
      { id: "customrole_wide", permissions: ["project:view", "project:delete"] },
    ].filter((role) => roleIds.includes(role.id)),
  );
  bindings.findBinding.mockImplementation(async ({ bindingId }) => {
    const found = rows.find((candidate) => candidate.id === bindingId);
    return found ? { ...found, organizationId: ORG } : null;
  });

  const ledger: AuthzCompatibilityLedger = {
    attachBindings: async (input) => {
      for (const binding of input.bindings) {
        rows.push(
          row({
            id: binding.bindingId,
            userId: "userId" in binding.principal ? binding.principal.userId : null,
            role: binding.role,
            customRoleId: binding.customRoleId,
            scopeType: binding.scopeType,
            scopeId: binding.scopeId,
          }),
        );
      }
      return { attached: [], duplicates: [] };
    },
    changeBindingRole: async (input) => {
      const at = rows.findIndex((candidate) => candidate.id === input.bindingId);
      const current = rows[at];
      if (current) rows[at] = { ...current, role: input.role, customRoleId: input.customRoleId };
    },
    revokeBindings: async (input) => {
      for (const id of input.bindingIds) {
        rows.splice(
          rows.findIndex((candidate) => candidate.id === id),
          1,
        );
      }
    },
    attachResourceGrant: async () => {},
    revokeResourceGrants: async () => {},
    revokeBindingsWhere: async () => 0,
    offboardMember: async () => {},
    defineRole: async () => {},
    deleteRole: async () => {},
  };
  const guards = {
    // The real rule, over what each caller is stated to hold.
    findPermissionsBeyondCaller: async (input: {
      caller: AuthzPrincipalRef;
      permissions: string[];
    }) => {
      callers.push(input.caller);
      const held = input.caller.type === "user" ? (HELD[input.caller.id] ?? []) : [];
      return findPermissionsBeyondHeld({ requested: input.permissions, held });
    },
    listManagedBindingsForOrganization: async ({ organizationId }: { organizationId: string }) =>
      organizationId === OTHER_ORG ? [...foreignRows] : [...rows],
  };
  const writer = AuthzBindingWriterService.create({
    bindings,
    ledger,
    newBindingId: () => `rb_new_${++next}`,
    permissions: guards,
  });
  const management = AuthzGrantManagementService.create({ writer, permissions: guards });
  const app = createAuthzTestApp({
    permissions: { listManagedBindingsForOrganization: guards.listManagedBindingsForOrganization },
    grants: {
      listGrants: (input) => management.list(input),
      createGrant: (input) => management.create(input),
      changeGrantRole: (input) => management.changeRole(input),
      revokeGrant: (input) => management.revoke(input),
    },
  });

  const procedures: Record<string, Procedure> = {};
  const permissions: Record<string, unknown> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, member, access, handle }) => {
      const invoke = handle as (args: TrpcContractHandlerArguments<unknown, AuthzApi>) => unknown;
      const name = procedure.split(".")[1]!;
      permissions[name] = access;
      procedures[name] = async (input: unknown) =>
        invoke({
          app,
          input: member.input.parse(input),
          actor: { type: "user", id: sessionUserId },
          scope: null,
          signal: undefined,
        });

      return {};
    },
    router: (record) => record,
  };
  authzTrpcTransport.router(runtime, () => app);

  return { procedures, permissions, rows, callers };
}

describe("the Roles & access grant procedures", () => {
  describe("when the page lists and writes grants", () => {
    /** @scenario Every grant write is gated on managing the organization */
    it("gates every grant procedure on organization:manage", () => {
      const { permissions } = world();

      for (const name of ["listGrants", "createGrant", "changeGrantRole", "revokeGrant"]) {
        expect(permissions[name]).toMatchObject({ permission: "organization:manage" });
      }
    });

    /** @scenario A manager grants a role within what they hold */
    it("grants a role the caller holds, bounded by the session user", async () => {
      const { procedures, callers } = world();

      const grant = await procedures.createGrant!({
        organizationId: ORG,
        grant: {
          principal: { type: "user", id: "user-2" },
          roleId: "customrole_ops",
          scope: { type: "team", id: "team-a" },
        },
      });

      expect(grant).toMatchObject({
        principal: { type: "user", id: "user-2" },
        role: { id: "customrole_ops", builtIn: false },
        scope: { type: "team", id: "team-a" },
      });
      expect(callers).toEqual([{ type: "user", id: MANAGER }]);
    });

    it("lists the organization's grants with a cursor", async () => {
      const { procedures } = world();

      const page = await procedures.listGrants!({ organizationId: ORG, query: { limit: 1 } });

      expect(page).toMatchObject({ grants: [{ id: "rb_other" }], nextCursor: expect.any(String) });
    });
  });

  describe("when a manager tries to escalate their own access", () => {
    /** @scenario A manager cannot grant themselves a role above their own */
    it("refuses a self-grant of admin, naming what the manager lacks", async () => {
      const { procedures, rows } = world();

      await expect(
        procedures.createGrant!({
          organizationId: ORG,
          grant: {
            principal: { type: "user", id: MANAGER },
            roleId: "admin",
            scope: { type: "organization", id: ORG },
          },
        }),
      ).rejects.toMatchObject({
        code: "grant_exceeds_caller_permissions",
        meta: { missingPermissions: expect.arrayContaining(["project:delete"]) },
      });
      expect(rows).toHaveLength(2);
    });

    /** @scenario A manager cannot widen the role they hold */
    it("refuses changing their own grant to a wider custom role", async () => {
      const { procedures, rows } = world();

      await expect(
        procedures.changeGrantRole!({
          organizationId: ORG,
          grantId: "rb_own",
          roleId: "customrole_wide",
        }),
      ).rejects.toMatchObject({
        code: "grant_exceeds_caller_permissions",
        meta: { missingPermissions: ["project:delete"] },
      });
      expect(rows.find((candidate) => candidate.id === "rb_own")?.customRoleId).toBe(
        "customrole_ops",
      );
    });

    /** @scenario The caller cannot be named in the request */
    it("refuses an input that names its own caller or actor", async () => {
      const { procedures } = world();
      const grant = {
        principal: { type: "user", id: MANAGER },
        roleId: "admin",
        scope: { type: "organization", id: ORG },
      };

      await expect(
        procedures.createGrant!({
          organizationId: ORG,
          grant,
          caller: { type: "user", id: "user-admin" },
        }),
      ).rejects.toThrow(/caller/);
      await expect(
        procedures.revokeGrant!({
          organizationId: ORG,
          grantId: "rb_other",
          actor: { type: "system", id: null },
        }),
      ).rejects.toThrow(/actor/);
    });
  });

  describe("when a request names something in another organization", () => {
    /** @scenario Another organization's grants, people and scopes are not reachable */
    it("answers grant_not_found for another organization's grant id", async () => {
      const { procedures } = world();

      await expect(
        procedures.revokeGrant!({ organizationId: ORG, grantId: "rb_foreign" }),
      ).rejects.toMatchObject({ code: "grant_not_found" });
      await expect(
        procedures.changeGrantRole!({
          organizationId: ORG,
          grantId: "rb_foreign",
          roleId: "viewer",
        }),
      ).rejects.toMatchObject({ code: "grant_not_found" });
    });

    /** @scenario Another organization's grants, people and scopes are not reachable */
    it("refuses a principal or a scope outside the organization", async () => {
      const { procedures, rows } = world();
      const grant = { roleId: "viewer", scope: { type: "team", id: "team-a" } };

      await expect(
        procedures.createGrant!({
          organizationId: ORG,
          grant: { ...grant, principal: { type: "user", id: "user-foreign" } },
        }),
      ).rejects.toMatchObject({ code: "grant_principal_not_found" });
      await expect(
        procedures.createGrant!({
          organizationId: ORG,
          grant: {
            ...grant,
            principal: { type: "user", id: "user-2" },
            scope: { type: "team", id: "team-foreign" },
          },
        }),
      ).rejects.toMatchObject({ code: "grant_scope_not_found" });
      expect(rows).toHaveLength(2);
    });
  });
});
