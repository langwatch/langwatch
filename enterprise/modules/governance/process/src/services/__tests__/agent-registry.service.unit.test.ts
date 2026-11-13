/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { ProcessHandlerContext } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import type { TraceApi, TraceAgentSeen } from "@langwatch/trace-contract";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import type { AgentRegistryDeliveryIntent } from "../../features/registry/eventing/agent-registry-delivery.process.ts";
import {
  AGENT_REGISTRY_TRAFFIC_INITIAL_STATE,
  type AgentRegistryTrafficIntents,
  agentRegistryTrafficWake,
} from "../../features/registry/eventing/agent-registry-traffic.process.ts";
import { AgentRegistryReadsService } from "../../features/registry/services/agent-registry-reads.service.ts";
import {
  type AgentRegistryDeliveryOutbox,
  AgentRegistryService,
} from "../../features/registry/services/agent-registry.service.ts";
import { MemoryAgentRegistryRepository } from "../../repositories/memory/memory.agent-registry.repository.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";

const ORG = "org-1";
const NOW = Temporal.Instant.from("2026-11-13T09:00:00Z");

function connectedAgent(id: string, name: string): Agent {
  return {
    id,
    projectId: "project-1",
    name,
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    type: "connected",
    config: { parameters: [], sdk: { name: "langwatch", version: "1.0.0", language: "python" } },
  };
}

function endpoint(id: string, enabledEvents: string[]): WebhookEndpointView {
  return {
    id,
    organizationId: ORG,
    destinationKind: "http",
    url: `https://hooks.acme.test/${id}`,
    sqs: null,
    enabledEvents,
    status: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 1,
    maxBatchDelayMs: 0,
    maxInFlight: 1,
    allowSelfSignedCertificate: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const wakeAt = (at: number): ProcessHandlerContext<AgentRegistryTrafficIntents> => ({
  at,
  now: at,
  key: "agentRegistryTraffic",
  projectId: "__global__",
  intent: intentAccessorOf({
    pass: (key, payload) => ({ intentType: "pass", messageKey: key, payload }),
  }),
});

const OUTBOX_DOWN = new Error("outbox unavailable");
const AGENT_STORE_DOWN = new Error("agent store unavailable");

class RecordingOutbox implements AgentRegistryDeliveryOutbox {
  readonly intents: AgentRegistryDeliveryIntent[] = [];
  failNext = false;

  async record(intents: readonly AgentRegistryDeliveryIntent[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw OUTBOX_DOWN;
    }
    this.intents.push(...intents);
  }
}

function setup({
  agents = [connectedAgent("agent-1", "Field agent")],
  endpoints = [endpoint("hook-governance", ["governance.agent.*"])],
  traffic = [],
  organizationIds = [ORG],
  enterpriseOrganizationIds = organizationIds,
  now = () => NOW,
}: {
  agents?: Agent[];
  endpoints?: WebhookEndpointView[];
  traffic?: TraceAgentSeen[];
  organizationIds?: string[];
  enterpriseOrganizationIds?: string[];
  now?: () => Instant;
} = {}) {
  const state: {
    agents: Agent[];
    failAgents: boolean;
    holdNextList?: Promise<void>;
    claimedTotal?: number;
  } = {
    agents,
    failAgents: false,
  };
  const registry = MemoryAgentRegistryRepository.create();
  const outbox = new RecordingOutbox();
  const reconciled: string[] = [];
  const service = AgentRegistryService.create({
    registry,
    discoveredAgents: MemoryGovernanceRepositories.create().discoveredAgents,
    agents: createApiFixture<AgentApi>({
      list: async ({ projectId }) => {
        if (state.failAgents) throw AGENT_STORE_DOWN;
        const data = state.agents.filter((agent) => agent.projectId === projectId);
        const hold = state.holdNextList;
        state.holdNextList = undefined;
        await hold;
        const total = state.claimedTotal ?? data.length;
        return { data, pagination: { page: 1, limit: 200, total, totalPages: 1 } };
      },
      platformUrl: ({ agentId }) => `https://app.langwatch.test/agents/${agentId}`,
    }),
    projects: createApiFixture<ProjectApi>({
      findLiveNonGovernanceIdsByOrganization: async ({ organizationId }) => {
        reconciled.push(organizationId);
        return ["project-1"];
      },
      listNamesByIds: async () => [
        {
          id: "project-1",
          name: "Checkout",
          slug: "checkout",
          teamId: "team-1",
          organizationId: ORG,
          isPersonal: false,
          ownerUserId: null,
          kind: "application",
        },
      ],
    }),
    organizations: createApiFixture<OrganizationApi>({
      findMembersWithDepartments: async () => [],
      listAllIds: async () => ({ ids: organizationIds, next: null }),
    }),
    traces: createApiFixture<TraceApi>({ findAgentsSeen: async () => traffic }),
    webhooks: createApiFixture<WebhookApi>({ getAll: async () => endpoints }),
    entitlements: {
      hasEnterprisePlan: async (organizationId) =>
        enterpriseOrganizationIds.includes(organizationId),
    },
    outbox: () => outbox,
    publicBaseUrl: "https://app.langwatch.test",
    logger: createTestLogger().logger,
    now,
  });
  const reads = AgentRegistryReadsService.create({
    registry,
    publicBaseUrl: "https://app.langwatch.test",
    now,
  });
  return { service, reads, registry, outbox, state, reconciled };
}

describe("AgentRegistryService", () => {
  describe("when reading the organisation's agents fails during a reconcile", () => {
    /** @scenario A source that cannot be read removes nothing */
    it("fails and leaves every entry's status and version as they were", async () => {
      const { service, registry, state } = setup();
      await service.reconcileOrganization({ organizationId: ORG });
      state.failAgents = true;

      await expect(service.reconcileOrganization({ organizationId: ORG })).rejects.toBe(
        AGENT_STORE_DOWN,
      );

      const entries = await registry.findEntries({ organizationId: ORG, limit: 100 });
      expect(entries.map((entry) => [entry.status, entry.version])).toEqual([["active", 1]]);
    });
  });

  describe("when a reconcile appends an event", () => {
    /** @scenario Every new event is pushed once to each subscribed webhook endpoint */
    it("records one intent for the subscribed endpoint keyed by the event id", async () => {
      const { service, outbox, registry } = setup({
        endpoints: [
          endpoint("hook-governance", ["governance.agent.*"]),
          endpoint("hook-gateway", ["gateway.*"]),
        ],
      });

      await service.reconcileOrganization({ organizationId: ORG });

      const [event] = await registry.findEventsAfter({ organizationId: ORG, limit: 10 });
      expect(event?.type).toBe("governance.agent.registered");
      expect(outbox.intents.map((intent) => [intent.endpointId, intent.eventId])).toEqual([
        ["hook-governance", event?.id],
      ]);
    });
  });

  describe("when an event's push was never recorded", () => {
    /** @scenario An event whose push was not recorded is pushed by the next reconcile */
    it("records its intents on the next reconcile with nothing changed", async () => {
      const { service, outbox } = setup();
      outbox.failNext = true;
      await expect(service.reconcileOrganization({ organizationId: ORG })).rejects.toBe(
        OUTBOX_DOWN,
      );
      expect(outbox.intents).toEqual([]);

      await service.reconcileOrganization({ organizationId: ORG });

      expect(outbox.intents.map((intent) => intent.eventType)).toEqual([
        "governance.agent.registered",
      ]);
    });
  });

  describe("when the traffic pass runs", () => {
    /** @scenario The scheduled traffic pass reconciles every organisation the registry holds */
    it("reconciles each organisation that holds an entry", async () => {
      const { service, reconciled } = setup({ organizationIds: [ORG, "org-2"] });
      await service.seedAll({});
      reconciled.length = 0;

      await expect(service.reconcileTraffic()).resolves.toEqual({
        organizations: 2,
        complete: true,
      });
      expect(reconciled.toSorted()).toEqual([ORG, "org-2"]);
    });
  });

  describe("when an agent's versions are read one page at a time", () => {
    /** @scenario An agent's versions are read in pages, oldest first */
    it("answers each page after the cursor and a null cursor on the last", async () => {
      const { service, reads, registry, state } = setup();
      for (const name of ["Field agent", "Field agent v2", "Field agent v3"]) {
        state.agents = [connectedAgent("agent-1", name)];
        await service.reconcileOrganization({ organizationId: ORG });
      }
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 10 });
      const id = entry?.id ?? "";

      const first = await reads.listVersions({ organizationId: ORG, id, limit: 2 });
      const second = await reads.listVersions({
        organizationId: ORG,
        id,
        cursor: first.next_cursor ?? undefined,
        limit: 2,
      });

      expect(first.data.map((event) => event.to_version)).toEqual([1, 2]);
      expect(first.next_cursor).not.toBeNull();
      expect(second.data.map((event) => event.to_version)).toEqual([3]);
      expect(second.next_cursor).toBeNull();
    });
  });

  describe("when the daily traffic pass walks every organisation", () => {
    /** @scenario The daily traffic pass also reaches organisations the registry does not hold */
    it("registers a traces-only organisation's agent as shadow", async () => {
      const { service, registry, reconciled } = setup({
        agents: [],
        traffic: [
          {
            agentName: "shadow-bot",
            agentId: null,
            model: null,
            spanCount: 3,
            firstSeenMs: NOW.epochMilliseconds - 60_000,
            lastSeenMs: NOW.epochMilliseconds,
          },
        ],
        organizationIds: [ORG],
      });
      await expect(service.reconcileTraffic()).resolves.toEqual({
        organizations: 0,
        complete: true,
      });

      await expect(service.reconcileTraffic({ everyOrganization: true })).resolves.toEqual({
        organizations: 1,
        complete: true,
      });

      expect(reconciled).toEqual([ORG]);
      const entries = await registry.findEntries({ organizationId: ORG, limit: 10 });
      expect(entries.map((entry) => [entry.name, entry.shadow])).toEqual([["shadow-bot", true]]);
    });
  });

  describe("when the first walk reaches an organisation the deploy seed has not", () => {
    /** @scenario The first walk over every organisation announces no existing agent */
    it("records the agents but sends no intent to the governance.* endpoint", async () => {
      const { service, registry, outbox } = setup({
        agents: [connectedAgent("agent-1", "Field agent"), connectedAgent("agent-2", "Desk agent")],
        endpoints: [endpoint("hook-governance", ["governance.*"])],
      });
      const first = agentRegistryTrafficWake(AGENT_REGISTRY_TRAFFIC_INITIAL_STATE, wakeAt(1_000));
      const pass = first.intents?.[0]?.payload as { everyOrganization: boolean; announce: boolean };

      await service.reconcileTraffic(pass);

      expect(pass).toMatchObject({ everyOrganization: true, announce: false });
      expect(outbox.intents).toHaveLength(0);
      const entries = await registry.findEntries({ organizationId: ORG, limit: 10 });
      expect(entries).toHaveLength(2);
    });
  });

  describe("when an organisation does not hold the Enterprise plan", () => {
    /** @scenario Traffic passes and walks skip organisations below the Enterprise plan */
    it("reconciles only the Enterprise organisations", async () => {
      const { service, registry, reconciled } = setup({
        organizationIds: [ORG, "org-free"],
        enterpriseOrganizationIds: [ORG],
      });

      await service.reconcileTraffic({ everyOrganization: true });

      expect(reconciled).toEqual([ORG]);
      await expect(
        registry.findEntries({ organizationId: "org-free", limit: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a listing cursor carries a timestamp that does not parse", () => {
    /** @scenario A listing cursor this registry never returned is refused */
    it("refuses it as a validation error", async () => {
      const { reads } = setup();
      const cursor = Buffer.from(JSON.stringify({ u: "not-a-date", i: "x" })).toString("base64url");

      await expect(
        reads.listEntries({ organizationId: ORG, limit: 10, cursor }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });
  });

  describe("when two reconciles of one organisation interleave", () => {
    /** @scenario A reconcile whose sources were read before a newer commit plans nothing */
    it("announces no removal for the agent the newer read registered", async () => {
      let tick = 0;
      const clock = () => NOW.add({ seconds: ++tick });
      const { service, registry, state } = setup({ agents: [], now: clock });
      let release = () => undefined as void;
      state.holdNextList = new Promise<void>((resolve) => {
        release = resolve;
      });

      const stale = service.reconcileOrganization({ organizationId: ORG });
      await vi.waitFor(() => expect(state.holdNextList).toBeUndefined());
      state.agents = [connectedAgent("agent-x", "Late agent")];
      await service.reconcileOrganization({ organizationId: ORG });
      release();
      await stale;

      const feed = await registry.findEventsAfter({ organizationId: ORG, limit: 10 });
      expect(feed.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 10 });
      expect(entry?.status).toBe("active");
    });
  });

  describe("when a project's agent pages come back short of their total", () => {
    /** @scenario A project whose agent read came back incomplete removes none of its agents */
    it("removes no agent of that project", async () => {
      const { service, registry, state } = setup({
        agents: [connectedAgent("agent-1", "Field agent"), connectedAgent("agent-2", "Desk agent")],
      });
      await service.reconcileOrganization({ organizationId: ORG });
      state.agents = [connectedAgent("agent-1", "Field agent")];
      state.claimedTotal = 2;

      await service.reconcileOrganization({ organizationId: ORG });

      const entries = await registry.findEntries({ organizationId: ORG, limit: 10 });
      expect(entries.map((entry) => entry.status)).toEqual(["active", "active"]);
    });
  });

  describe("when traces name an agent of a project whose agent read came back incomplete", () => {
    /** @scenario Traffic of a project whose agent read came back incomplete flags no shadow agent */
    it("registers no shadow entry for it", async () => {
      const field = connectedAgent("agent-1", "Field agent");
      const desk = connectedAgent("agent-2", "Desk agent");
      const { service, registry, state } = setup({
        agents: [field, desk],
        traffic: [
          {
            agentName: "Desk agent",
            agentId: null,
            model: null,
            spanCount: 4,
            firstSeenMs: NOW.epochMilliseconds - 1_000,
            lastSeenMs: NOW.epochMilliseconds,
          },
        ],
      });
      await service.reconcileOrganization({ organizationId: ORG });
      state.agents = [field];
      state.claimedTotal = 2;

      await service.reconcileOrganization({ organizationId: ORG });

      const entries = await registry.findEntries({ organizationId: ORG, limit: 10 });
      expect(
        entries
          .map((entry) => [entry.name, entry.source, entry.status])
          .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ["Desk agent", "langwatch", "active"],
        ["Field agent", "langwatch", "active"],
      ]);
    });
  });

  describe("when the deploy seed fills the registry", () => {
    /** @scenario The deploy seed fills the feed without pushing webhooks */
    it("appends the events and records no delivery intent", async () => {
      const { service, registry, outbox } = setup();

      await service.seedAll({});

      const feed = await registry.findEventsAfter({ organizationId: ORG, limit: 10 });
      expect(feed.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      expect(outbox.intents).toEqual([]);
      await expect(
        registry.findUndeliveredEvents({ organizationId: ORG, limit: 10 }),
      ).resolves.toEqual([]);
    });
  });
});
