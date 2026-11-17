/**
 * @vitest-environment node
 * The A2A target routes: who may call each one, and what each hands the UI.
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authorization";
import {
  GatewayOrganizationNotFoundError,
  gatewayA2aTargetTrpc,
  type GatewayA2aTargetResource,
  type GatewayApi,
} from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

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
    assertOrganizationExists: vi.fn(async () => undefined),
    listA2aTargets: vi.fn(async () => [target()]),
    createA2aTarget: vi.fn(async () => target()),
    updateA2aTarget: vi.fn(async () => target({ agentName: "Renamed" })),
    setA2aTargetBlocked: vi.fn(async () => target({ blocked: true, blockReason: "incident" })),
    archiveA2aTarget: vi.fn(async () => target({ archivedAt: new Date() })),
  };
}

/** Mounts the declaration and keeps each procedure's permission and handler. */
function mounted(app: ReturnType<typeof fakeApp>) {
  const permissions: Record<string, AuthzPermission | object> = {};
  const handlers: Record<string, Handler> = {};
  const audits: Record<string, unknown> = {};
  const api = createApiFixture<GatewayApi>(app);
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access, audit, handle, procedure }) => {
      const name = procedure.slice(procedure.indexOf(".") + 1);
      if (audit) audits[name] = audit;
      permissions[name] = access.kind === "permission" ? access.permission : access;
      handlers[name] = (args) =>
        Promise.resolve((handle as (given: unknown) => unknown)({ ...args, app: api }));
      return {};
    },
    router: (record) => record,
  };
  gatewayA2aTargetTrpcTransport.router(runtime, () => api);
  return { permissions, handlers, audits };
}

describe("the gatewayA2aTargets tRPC declaration", () => {
  describe("given the five target procedures", () => {
    it("lets viewers list and only managers write", () => {
      const { permissions } = mounted(fakeApp());

      expect(Object.keys(gatewayA2aTargetTrpc.members).toSorted()).toEqual(
        ["create", "delete", "list", "setBlocked", "update"].toSorted(),
      );
      expect(permissions).toEqual({
        list: "virtualKeys:view",
        create: "virtualKeys:manage",
        update: "virtualKeys:manage",
        setBlocked: "virtualKeys:manage",
        delete: "virtualKeys:manage",
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

      expect(app.assertOrganizationExists).toHaveBeenCalledWith(ORG_ID);
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

    it("archives a target on delete", async () => {
      const app = fakeApp();
      await mounted(app).handlers.delete!({
        input: { id: "a2a_1", organizationId: ORG_ID },
        actor,
      });

      expect(app.archiveA2aTarget).toHaveBeenCalledWith({ id: "a2a_1", organizationId: ORG_ID });
    });
  });

  describe("given an organization that does not exist", () => {
    it("refuses before touching any target", async () => {
      const app = fakeApp();
      app.assertOrganizationExists.mockRejectedValueOnce(new GatewayOrganizationNotFoundError());

      await expect(
        mounted(app).handlers.list!({ input: { organizationId: "org_missing" }, actor }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(app.listA2aTargets).not.toHaveBeenCalled();
    });
  });
});
