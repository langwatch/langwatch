/**
 * @vitest-environment node
 *
 * The `gatewaySpendEvents.list` transport: it is a thin handler over
 * {@link GatewayApp.findSpendEventsPage}, so this file pins only the wiring -
 * the declared scope and the degrade when the application answers null -
 * leaving the assembly itself to `gateway-spend-events-page.unit.test.ts`.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createTrpcRuntime, type TrpcRuntimePorts } from "@langwatch/api/trpc";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { Temporal } from "@langwatch/time";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp, type GatewayAppDependencies } from "../../app/gateway.app.ts";
import type { GatewaySpendEventsService } from "../../services/gateway-spend-events.service.ts";
import { gatewaySpendEventTrpcTransport } from "../gateway-spend-event.trpc.ts";

type GatewayTrpcTestContext = { actor: { id: string } };

/** The process ports a mounted declaration runs on, as this suite supplies them. */
function testPorts(
  permits: (permission: AuthzPermission) => boolean = () => true,
): TrpcRuntimePorts<GatewayTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

const getSpendEventsPage = vi.fn();

function spendEventsStub(overrides: Partial<GatewaySpendEventsService>): GatewaySpendEventsService {
  return overrides as GatewaySpendEventsService;
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
}

/** The slice of the application this surface reaches, and nothing else. */
function gatewayAppStub({ clickHouse = true } = {}): GatewayApp {
  const dependencies: Partial<GatewayAppDependencies> = {
    spendEvents: clickHouse ? spendEventsStub({ getSpendEventsPage }) : undefined,
    projects: projectsStub({ tryGetOrganizationId: async () => "org_1" }),
    resolveVirtualKeyNames: async () => [{ id: "vk_1", name: "Customer A key" }],
  };
  return GatewayApp.create({
    dependencies: {},
    // `virtualKeys` is the discriminant GatewayApp uses to tell a full core
    // dependency bag from REST-only members; a stub exercising the
    // core app must carry the key even when this suite never reads it.
    members: { virtualKeys: {}, ...dependencies } as GatewayAppDependencies,
    config: undefined,
    resources: new ResourceScope(),
  });
}

const BASE_INPUT = {
  projectId: "project_1",
  fromMs: Date.parse("2026-07-01T00:00:00Z"),
  toMs: Date.parse("2026-07-29T00:00:00Z"),
};

function caller(
  permits?: (permission: AuthzPermission) => boolean,
  options?: { clickHouse?: boolean },
) {
  const app = gatewayAppStub(options);
  const trpc = initTRPC.context<GatewayTrpcTestContext>().create();
  const router = createTrpcRuntime<GatewayTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: testPorts(permits),
  }).mount(gatewaySpendEventTrpcTransport, () => app);

  return router.createCaller({ actor: { id: "usr_1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSpendEventsPage.mockResolvedValue({
    rows: [{ virtualKeyId: "vk_1", occurredAt: Temporal.Instant.from("2026-07-20T12:00:00Z") }],
    nextCursor: null,
  });
});

describe("gatewaySpendEvents.list", () => {
  describe("given the caller holds gatewayUsage:view", () => {
    /** @scenario Ledger rows resolve virtual key display names */
    it("answers the page the application resolved", async () => {
      const result = await caller().list(BASE_INPUT);

      expect(result.virtualKeyNames).toEqual({ vk_1: "Customer A key" });
      expect(getSpendEventsPage).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: BASE_INPUT.projectId }),
      );
    });
  });

  describe("when the deployment has no ClickHouse spend path", () => {
    /** @scenario The ledger degrades to an empty page without ClickHouse */
    it("degrades to an empty page", async () => {
      const result = await caller(undefined, { clickHouse: false }).list(BASE_INPUT);

      expect(result).toMatchObject({ rows: [], nextCursor: null, clickHouseDisabled: true });
      expect(getSpendEventsPage).not.toHaveBeenCalled();
    });
  });

  describe("when the caller lacks gatewayUsage:view", () => {
    /** @scenario The ledger requires the gateway usage view scope */
    it("never reaches the application", async () => {
      await expect(caller(() => false).list(BASE_INPUT)).rejects.toThrow();
      expect(getSpendEventsPage).not.toHaveBeenCalled();
    });
  });
});
