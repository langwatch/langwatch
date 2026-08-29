import { initTRPC } from "@trpc/server";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { Role, RoleService } from "@langwatch/role-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RoleApp,
  RoleBindingTrpcApi,
  roleBindingTrpcInputSchemas,
  RoleTrpcApi,
  roleTrpcInputSchemas,
  type RoleBindingTrpcContext,
  type RoleTrpcContext,
} from "../index";

const ORGANIZATION_ID = "organization_1";
const USER_ID = "user_1";
const ACTOR = { type: "user", id: USER_ID };

const role: Role = {
  id: "role_1",
  organizationId: ORGANIZATION_ID,
  name: "Reviewer",
  description: null,
  permissions: ["traces:view"],
  kind: "custom",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

type Call = { method: string; input: unknown };

function recordingRoles(calls: Call[]) {
  const record =
    (method: string, result: unknown) =>
    async (input: unknown) => {
      calls.push({ method, input });
      return result;
    };

  return {
    list: record("list", [role]),
    get: record("get", role),
    create: record("create", role),
    update: record("update", role),
    remove: record("remove", { success: true }),
    assignToUser: record("assignToUser", { success: true }),
    removeFromUser: record("removeFromUser", { success: true }),
    getAssignmentOrganization: record("getAssignmentOrganization", ORGANIZATION_ID),
  } as unknown as RoleService;
}

function roleCaller(calls: Call[]) {
  const trpc = initTRPC.context<RoleTrpcContext>().create();
  const inputs = roleTrpcInputSchemas({ customRolePermission: z.string() });
  const procedure = trpc.procedure;

  const router = RoleTrpcApi.create(trpc, {
    getAll: procedure.input(inputs.getAll),
    getById: procedure.input(inputs.getById),
    create: procedure.input(inputs.create),
    update: procedure.input(inputs.update),
    delete: procedure.input(inputs.delete),
    assignToUser: procedure.input(inputs.assignToUser),
    removeFromUser: procedure.input(inputs.removeFromUser),
  });

  return router.createCaller({
    app: {
      roles: RoleApp.create({
        roles: recordingRoles(calls),
        // The definition surface never reaches the binding half of the
        // application, and this asserts that: a call that did would throw.
        permissions: {} as AuthzService,
        authzGrants: {} as AuthzGrantsService,
      }),
    },
    actor: () => ({ id: USER_ID }),
  });
}

describe("Feature: role app tRPC adapter", () => {
  describe("given a caller the process already authorized", () => {
    it("lists an organization's roles through the service", async () => {
      const calls: Call[] = [];

      await expect(roleCaller(calls).getAll({ organizationId: ORGANIZATION_ID })).resolves.toEqual([
        role,
      ]);
      expect(calls).toEqual([{ method: "list", input: { organizationId: ORGANIZATION_ID } }]);
    });

    it("reads one role by its id", async () => {
      const calls: Call[] = [];

      await expect(roleCaller(calls).getById({ roleId: role.id })).resolves.toEqual(role);
      expect(calls).toEqual([{ method: "get", input: { roleId: role.id } }]);
    });

    it("attributes a created role to the calling member", async () => {
      const calls: Call[] = [];

      await roleCaller(calls).create({
        organizationId: ORGANIZATION_ID,
        name: "Reviewer",
        permissions: ["traces:view"],
      });

      expect(calls).toEqual([
        {
          method: "create",
          input: {
            role: {
              organizationId: ORGANIZATION_ID,
              name: "Reviewer",
              description: undefined,
              permissions: ["traces:view"],
            },
            actor: ACTOR,
          },
        },
      ]);
    });

    it("passes only the fields an update names", async () => {
      const calls: Call[] = [];

      await roleCaller(calls).update({ roleId: role.id, name: "Auditor" });

      expect(calls).toEqual([
        {
          method: "update",
          input: {
            roleId: role.id,
            changes: { name: "Auditor", description: undefined, permissions: undefined },
            actor: ACTOR,
          },
        },
      ]);
    });

    it("removes a role", async () => {
      const calls: Call[] = [];

      await expect(roleCaller(calls).delete({ roleId: role.id })).resolves.toEqual({
        success: true,
      });
      expect(calls).toEqual([{ method: "remove", input: { roleId: role.id, actor: ACTOR } }]);
    });

    it("assigns a role to a team member", async () => {
      const calls: Call[] = [];

      await roleCaller(calls).assignToUser({
        userId: "user_2",
        teamId: "team_1",
        customRoleId: role.id,
      });

      expect(calls).toEqual([
        {
          method: "assignToUser",
          input: {
            userId: "user_2",
            teamId: "team_1",
            customRoleId: role.id,
            actor: ACTOR,
          },
        },
      ]);
    });

    it("removes a team member's role without reading the role id back", async () => {
      const calls: Call[] = [];

      await roleCaller(calls).removeFromUser({
        userId: "user_2",
        teamId: "team_1",
        customRoleId: role.id,
      });

      expect(calls).toEqual([
        {
          method: "removeFromUser",
          input: { userId: "user_2", teamId: "team_1", actor: ACTOR },
        },
      ]);
    });
  });

  describe("given a permission the process's vocabulary refuses", () => {
    it("rejects the create before the service is reached", async () => {
      const calls: Call[] = [];
      const trpc = initTRPC.context<RoleTrpcContext>().create();
      const inputs = roleTrpcInputSchemas({
        customRolePermission: z.string().refine((value) => value === "traces:view"),
      });
      const procedure = trpc.procedure;
      const router = RoleTrpcApi.create(trpc, {
        getAll: procedure.input(inputs.getAll),
        getById: procedure.input(inputs.getById),
        create: procedure.input(inputs.create),
        update: procedure.input(inputs.update),
        delete: procedure.input(inputs.delete),
        assignToUser: procedure.input(inputs.assignToUser),
        removeFromUser: procedure.input(inputs.removeFromUser),
      });
      const caller = router.createCaller({
        app: { roles: recordingRoles(calls) },
        actor: () => ({ id: USER_ID }),
      });

      await expect(
        caller.create({
          organizationId: ORGANIZATION_ID,
          name: "Reviewer",
          permissions: ["traces:rotate"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(calls).toEqual([]);
    });
  });
});

function bindingCaller(calls: Call[]) {
  const trpc = initTRPC.context<RoleBindingTrpcContext>().create();
  const inputs = roleBindingTrpcInputSchemas();
  const procedure = trpc.procedure;

  const router = RoleBindingTrpcApi.create(trpc, {
    listForOrg: procedure.input(inputs.listForOrg),
    listForUser: procedure.input(inputs.listForUser),
    getMyAccessBreakdown: procedure.input(inputs.getMyAccessBreakdown),
    create: procedure.input(inputs.create),
    update: procedure.input(inputs.update),
    delete: procedure.input(inputs.delete),
    applyMemberBindings: procedure.input(inputs.applyMemberBindings),
  });

  const record =
    (method: string, result: unknown) =>
    async (input: unknown) => {
      calls.push({ method, input });
      return result;
    };

  return router.createCaller({
    app: {
      roles: RoleApp.create({
        // The binding surface never reaches the definition half.
        roles: {} as RoleService,
        permissions: {
          listManagedBindingsForOrganization: record("listManagedBindingsForOrganization", []),
          listManagedBindingsForUser: record("listManagedBindingsForUser", []),
          getAccessBreakdown: record("getAccessBreakdown", { bindings: [] }),
        } as unknown as AuthzService,
        authzGrants: {
          createBinding: record("createBinding", { id: "binding_1" }),
          updateBinding: record("updateBinding", { id: "binding_1" }),
          deleteBinding: record("deleteBinding", { success: true }),
          applyMemberBindings: record("applyMemberBindings", { success: true }),
        } as unknown as AuthzGrantsService,
      }),
    },
    actor: () => ({ id: USER_ID }),
    session: { user: { name: "Ada", email: "ada@example.com" } },
  } as unknown as RoleBindingTrpcContext);
}

describe("Feature: role binding app tRPC adapter", () => {
  describe("given a caller the process already authorized", () => {
    it("lists an organization's bindings", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).listForOrg({ organizationId: ORGANIZATION_ID });

      expect(calls).toEqual([
        {
          method: "listManagedBindingsForOrganization",
          input: { organizationId: ORGANIZATION_ID },
        },
      ]);
    });

    it("lists one member's bindings", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).listForUser({
        organizationId: ORGANIZATION_ID,
        userId: "user_2",
      });

      expect(calls).toEqual([
        {
          method: "listManagedBindingsForUser",
          input: { organizationId: ORGANIZATION_ID, userId: "user_2" },
        },
      ]);
    });

    it("labels the caller's own access breakdown with their identity", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).getMyAccessBreakdown({ organizationId: ORGANIZATION_ID });

      expect(calls).toEqual([
        {
          method: "getAccessBreakdown",
          input: {
            organizationId: ORGANIZATION_ID,
            userId: USER_ID,
            userName: "Ada",
            userEmail: "ada@example.com",
          },
        },
      ]);
    });

    it("creates a binding attributed to the calling member", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).create({
        organizationId: ORGANIZATION_ID,
        userId: "user_2",
        role: "VIEWER",
        scopeType: "PROJECT",
        scopeId: "project_1",
      });

      expect(calls).toEqual([
        {
          method: "createBinding",
          input: {
            organizationId: ORGANIZATION_ID,
            actor: ACTOR,
            userId: "user_2",
            groupId: undefined,
            role: "VIEWER",
            customRoleId: undefined,
            scopeType: "PROJECT",
            scopeId: "project_1",
          },
        },
      ]);
    });

    it("updates the role on a binding", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).update({
        organizationId: ORGANIZATION_ID,
        bindingId: "binding_1",
        role: "ADMIN",
      });

      expect(calls).toEqual([
        {
          method: "updateBinding",
          input: {
            organizationId: ORGANIZATION_ID,
            actor: ACTOR,
            bindingId: "binding_1",
            role: "ADMIN",
            customRoleId: undefined,
          },
        },
      ]);
    });

    it("deletes a binding", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).delete({
        organizationId: ORGANIZATION_ID,
        bindingId: "binding_1",
      });

      expect(calls).toEqual([
        {
          method: "deleteBinding",
          input: {
            organizationId: ORGANIZATION_ID,
            actor: ACTOR,
            bindingId: "binding_1",
          },
        },
      ]);
    });

    it("applies a member's whole access batch in one call", async () => {
      const calls: Call[] = [];

      await bindingCaller(calls).applyMemberBindings({
        organizationId: ORGANIZATION_ID,
        userId: "user_2",
        bindingIdsToDelete: ["binding_1"],
        bindingsToCreate: [{ role: "VIEWER", scopeType: "TEAM", scopeId: "team_1" }],
      });

      expect(calls).toEqual([
        {
          method: "applyMemberBindings",
          input: {
            organizationId: ORGANIZATION_ID,
            actor: ACTOR,
            userId: "user_2",
            bindingIdsToDelete: ["binding_1"],
            bindingsToCreate: [
              { role: "VIEWER", customRoleId: undefined, scopeType: "TEAM", scopeId: "team_1" },
            ],
          },
        },
      ]);
    });
  });
});
