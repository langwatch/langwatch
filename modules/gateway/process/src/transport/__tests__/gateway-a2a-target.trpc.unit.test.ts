/**
 * @vitest-environment node
 * The A2A target routes: who may call each one, and what each hands the UI.
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { ALL_PERMISSIONS, type AuthzPermission } from "@langwatch/authorization";
import {
  AuthzEngine,
  type AuthzScopeRef,
  type CollectedBinding,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import {
  GatewayOrganizationNotFoundError,
  gatewayA2aTargetTrpc,
  type GatewayA2aTargetResource,
  type GatewayApi,
} from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { a2aTargetToDto } from "../../rules/gateway-a2a-target.rules.ts";
import { gatewayA2aTargetTrpcTransport } from "../gateway-a2a-target.trpc.ts";

type Handler = (args: { input: unknown; actor: { type: "user"; id: string } }) => Promise<unknown>;

const ORG_ID = "org_1";
const actor = { type: "user" as const, id: "usr_1" };

function target(overrides: Partial<GatewayA2aTargetResource> = {}): GatewayA2aTargetResource {
  return {
    id: "a2a_1",
    organizationId: ORG_ID,
    projectId: null,
    name: "billing-agent",
    agentName: "Billing agent",
    cardUrl: "https://agents.acme.example/.well-known/agent-card.json",
    upstreamUrl: "https://agents.acme.example/a2a",
    upstreamHeaders: { Authorization: "Bearer secret", "X-Tenant": "acme" },
    allowedVirtualKeyIds: null,
    blocked: false,
    blockReason: null,
    createdById: "usr_1",
    createdAt: new Date("2026-11-17T00:00:00Z"),
    updatedAt: new Date("2026-11-17T00:00:00Z"),
    archivedAt: null,
    ...overrides,
  };
}

function fakeApp() {
  return {
    listA2aTargets: vi.fn(async () => [a2aTargetToDto(target())]),
    createA2aTarget: vi.fn(async () => a2aTargetToDto(target())),
    updateA2aTarget: vi.fn(async () => a2aTargetToDto(target({ agentName: "Renamed" }))),
    setA2aTargetBlocked: vi.fn(async () =>
      a2aTargetToDto(target({ blocked: true, blockReason: "incident" })),
    ),
    archiveA2aTarget: vi.fn(async () => a2aTargetToDto(target({ archivedAt: new Date() }))),
    listProjectA2aTargets: vi.fn(async () => [a2aTargetToDto(target({ projectId: "p1" }))]),
    updateProjectA2aTarget: vi.fn(async () => a2aTargetToDto(target({ projectId: "p1" }))),
    setProjectA2aTargetBlocked: vi.fn(async () =>
      a2aTargetToDto(target({ projectId: "p1", blocked: true })),
    ),
    archiveProjectA2aTarget: vi.fn(async () => a2aTargetToDto(target({ projectId: "p1" }))),
  };
}

/** Mounts the declaration and keeps each procedure's permission and handler. */
function mounted(app: ReturnType<typeof fakeApp>) {
  const permissions: Record<string, AuthzPermission | object> = {};
  const handlers: Record<string, Handler> = {};
  const audits: Record<string, unknown> = {};
  const accesses: Record<string, unknown> = {};
  const api = createApiFixture<GatewayApi>(app);
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access, audit, handle, procedure }) => {
      const name = procedure.slice(procedure.indexOf(".") + 1);
      if (audit) audits[name] = audit;
      accesses[name] = access;
      permissions[name] = access.kind === "permission" ? access.permission : access;
      handlers[name] = (args) =>
        Promise.resolve((handle as (given: unknown) => unknown)({ ...args, app: api }));
      return {};
    },
    router: (record) => record,
  };
  gatewayA2aTargetTrpcTransport.router(runtime, () => api);
  return { permissions, handlers, audits, accesses };
}

const engine = new AuthzEngine();
const TEAM_ID = "team_1";
const PROJECT: AuthzScopeRef = {
  type: "project",
  id: "p1",
  teamId: TEAM_ID,
  organizationId: ORG_ID,
};
const ORGANIZATION: AuthzScopeRef = { type: "organization", id: ORG_ID };
const VIRTUAL_KEY_MANAGER = ALL_PERMISSIONS.filter((permission) =>
  permission.startsWith("virtualKeys:"),
);

function grantsOf({
  binding,
  organizationRole = "MEMBER",
  customPermissions = [],
}: {
  binding: Omit<CollectedBinding, "viaGroupId">;
  organizationRole?: CollectedGrants["organizationRole"];
  customPermissions?: readonly string[];
}): CollectedGrants {
  return {
    principal: { type: "user", id: actor.id },
    organizationId: ORG_ID,
    organizationRole,
    isOrgMember: true,
    membershipDisabled: false,
    bindings: [{ ...binding, viaGroupId: null }],
    customRolePermissions: new Map([["role", customPermissions]]),
  };
}

/** Every procedure the door would let these grants through, asked at its own scope. */
function passedProcedures(grants: CollectedGrants): string[] {
  const { accesses } = mounted(fakeApp());
  return Object.entries(accesses)
    .filter(([name, access]) => {
      const { permission } = access as { permission: AuthzPermission };
      const scope = name.endsWith("ForProject") ? PROJECT : ORGANIZATION;
      return engine.decide({ grants, permission, scope }).allowed;
    })
    .map(([name]) => name)
    .toSorted();
}

const PROJECT_PROCEDURES = [
  "archiveForProject",
  "listForProject",
  "setBlockedForProject",
  "updateForProject",
];

describe("the gatewayA2aTargets tRPC declaration", () => {
  describe("given a caller who manages virtual keys but holds no A2A target permission", () => {
    /** @scenario "A2A targets have their own permission, apart from virtual keys" */
    it("refuses every procedure, at the project and at the organization", () => {
      for (const scopeType of ["PROJECT", "ORGANIZATION"] as const) {
        const grants = grantsOf({
          binding: {
            roleKey: "custom:role",
            scopeType,
            scopeId: scopeType === "PROJECT" ? "p1" : ORG_ID,
          },
          customPermissions: VIRTUAL_KEY_MANAGER,
        });

        expect(passedProcedures(grants)).toEqual([]);
      }
    });

    /** @scenario "A2A targets have their own permission, apart from virtual keys" */
    it("lets a holder of gatewayA2aTargets:manage through every procedure", () => {
      const grants = grantsOf({
        binding: { roleKey: "custom:role", scopeType: "ORGANIZATION", scopeId: ORG_ID },
        customPermissions: ["gatewayA2aTargets:manage"],
      });

      expect(passedProcedures(grants)).toEqual(
        Object.keys(gatewayA2aTargetTrpc.members).toSorted(),
      );
    });

    /** @scenario "A2A targets have their own permission, apart from virtual keys" */
    it("lets a holder of gatewayA2aTargets:view list and change nothing", () => {
      const grants = grantsOf({
        binding: { roleKey: "custom:role", scopeType: "ORGANIZATION", scopeId: ORG_ID },
        customPermissions: ["gatewayA2aTargets:view"],
      });

      expect(passedProcedures(grants)).toEqual(["list", "listForProject"]);
    });
  });

  describe("given the built-in roles", () => {
    /** @scenario "The built-in roles hold the A2A target permissions they hold on cache rules" */
    it("lets a team viewer and member list the project's targets and change none", () => {
      for (const roleKey of ["viewer", "member"] as const) {
        const grants = grantsOf({ binding: { roleKey, scopeType: "TEAM", scopeId: TEAM_ID } });

        expect(passedProcedures(grants)).toEqual(["listForProject"]);
      }
    });

    /** @scenario "The built-in roles hold the A2A target permissions they hold on cache rules" */
    it("lets a team admin manage the project's targets", () => {
      const grants = grantsOf({
        binding: { roleKey: "admin", scopeType: "TEAM", scopeId: TEAM_ID },
      });

      expect(passedProcedures(grants)).toEqual(PROJECT_PROCEDURES);
    });

    /** @scenario "The built-in roles hold the A2A target permissions they hold on cache rules" */
    it("lets an organization admin manage every target", () => {
      const grants = grantsOf({
        organizationRole: "ADMIN",
        binding: { roleKey: "admin", scopeType: "ORGANIZATION", scopeId: ORG_ID },
      });

      expect(passedProcedures(grants)).toEqual(
        Object.keys(gatewayA2aTargetTrpc.members).toSorted(),
      );
    });
  });

  describe("given the project-scoped target procedures", () => {
    /** @scenario "a project admin manages the project's own targets" */
    it("checks the permission on the project named in the input", () => {
      const { accesses } = mounted(fakeApp());
      const expected = {
        listForProject: "gatewayA2aTargets:view",
        updateForProject: "gatewayA2aTargets:manage",
        setBlockedForProject: "gatewayA2aTargets:manage",
        archiveForProject: "gatewayA2aTargets:manage",
      };

      for (const [name, permission] of Object.entries(expected)) {
        expect(accesses[name]).toMatchObject({ kind: "permission", permission });
        expect(JSON.stringify(accesses[name])).toContain("projectId");
      }
    });

    it("hands each call the project and the calling user", async () => {
      const app = fakeApp();
      const { handlers } = mounted(app);
      await handlers.listForProject!({ input: { projectId: "p1" }, actor });
      await handlers.updateForProject!({
        input: { projectId: "p1", id: "a2a_1", agentName: "Renamed" },
        actor,
      });
      await handlers.setBlockedForProject!({
        input: { projectId: "p1", id: "a2a_1", blocked: true, blockReason: null },
        actor,
      });
      await handlers.archiveForProject!({ input: { projectId: "p1", id: "a2a_1" }, actor });

      expect(app.listProjectA2aTargets).toHaveBeenCalledWith({ projectId: "p1" });
      expect(app.updateProjectA2aTarget).toHaveBeenCalledWith({
        projectId: "p1",
        id: "a2a_1",
        agentName: "Renamed",
        actorUserId: "usr_1",
      });
      expect(app.setProjectA2aTargetBlocked).toHaveBeenCalledWith({
        projectId: "p1",
        id: "a2a_1",
        blocked: true,
        blockReason: null,
        actorUserId: "usr_1",
      });
      expect(app.archiveProjectA2aTarget).toHaveBeenCalledWith({
        projectId: "p1",
        id: "a2a_1",
        actorUserId: "usr_1",
      });
    });
  });

  describe("given the organization target procedures", () => {
    it("lets viewers list and only managers write", () => {
      const { permissions } = mounted(fakeApp());

      expect(Object.keys(gatewayA2aTargetTrpc.members).toSorted()).toEqual(
        [
          "create",
          "archive",
          "archiveForProject",
          "list",
          "listForProject",
          "setBlocked",
          "setBlockedForProject",
          "update",
          "updateForProject",
        ].toSorted(),
      );
      expect(permissions).toMatchObject({
        list: "gatewayA2aTargets:view",
        create: "gatewayA2aTargets:manage",
        update: "gatewayA2aTargets:manage",
        setBlocked: "gatewayA2aTargets:manage",
        archive: "gatewayA2aTargets:manage",
      });
    });

    it("records a project-scoped create against the project's organization", () => {
      const { audits } = mounted(fakeApp());

      expect(audits).toEqual({ create: { target: "organization", via: "projectId" } });
    });
  });

  describe("given an existing organization", () => {
    it("lists targets with header names only, never header values", async () => {
      const app = fakeApp();
      const result = await mounted(app).handlers.list!({
        input: { organizationId: ORG_ID },
        actor,
      });

      expect(result).toEqual([
        expect.objectContaining({
          name: "billing-agent",
          upstreamHeaderNames: ["Authorization", "X-Tenant"],
          createdAt: "2026-11-17T00:00:00.000Z",
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain("Bearer secret");
    });

    it("creates a target as the calling user", async () => {
      const app = fakeApp();
      const input = {
        organizationId: ORG_ID,
        projectId: null,
        name: "billing-agent",
        agentName: "Billing agent",
        cardUrl: "https://agents.acme.example/.well-known/agent-card.json",
        upstreamUrl: "https://agents.acme.example/a2a",
      };
      const result = await mounted(app).handlers.create!({ input, actor });

      expect(app.createA2aTarget).toHaveBeenCalledWith({ ...input, actorUserId: "usr_1" });
      expect(result).toEqual(expect.objectContaining({ id: "a2a_1" }));
    });

    it("updates a target as the calling user", async () => {
      const app = fakeApp();
      const input = { id: "a2a_1", organizationId: ORG_ID, agentName: "Renamed" };
      const result = await mounted(app).handlers.update!({ input, actor });

      expect(app.updateA2aTarget).toHaveBeenCalledWith({ ...input, actorUserId: "usr_1" });
      expect(result).toEqual(expect.objectContaining({ agentName: "Renamed" }));
    });

    it("blocks a target with its reason", async () => {
      const app = fakeApp();
      const input = { id: "a2a_1", organizationId: ORG_ID, blocked: true, blockReason: "incident" };
      const result = await mounted(app).handlers.setBlocked!({ input, actor });

      expect(app.setA2aTargetBlocked).toHaveBeenCalledWith({ ...input, actorUserId: "usr_1" });
      expect(result).toEqual(expect.objectContaining({ blocked: true, blockReason: "incident" }));
    });

    it("archives a target", async () => {
      const app = fakeApp();
      await mounted(app).handlers.archive!({
        input: { id: "a2a_1", organizationId: ORG_ID },
        actor,
      });

      expect(app.archiveA2aTarget).toHaveBeenCalledWith({
        id: "a2a_1",
        organizationId: ORG_ID,
        actorUserId: "usr_1",
      });
    });
  });

  describe("given an organization that does not exist", () => {
    it("passes the coded organization refusal through", async () => {
      const app = fakeApp();
      app.listA2aTargets.mockRejectedValueOnce(new GatewayOrganizationNotFoundError());

      await expect(
        mounted(app).handlers.list!({ input: { organizationId: "org_missing" }, actor }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
