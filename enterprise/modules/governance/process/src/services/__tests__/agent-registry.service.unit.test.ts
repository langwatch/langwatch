/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type {
  AgentRegistryEventPage,
  AgentRegistryEventType,
  AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import type { TraceApi, TraceAgentSeen } from "@langwatch/trace-contract";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import { OutboxAgentRegistryDelivery } from "../../features/registry/eventing/agent-registry-delivery.intent.ts";
import {
  AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
  AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
  type AgentRegistryAlertIntent,
  type AgentRegistryDeliveryIntent,
} from "../../features/registry/eventing/agent-registry-delivery.process.ts";
import { AgentRegistryReadsService } from "../../features/registry/services/agent-registry-reads.service.ts";
import {
  type AgentRegistryDeliveryOutbox,
  type AgentRegistryFanOut,
  AgentRegistryService,
} from "../../features/registry/services/agent-registry.service.ts";
import { MemoryAgentRegistrySettingsRepository } from "../../repositories/memory/memory.agent-registry-settings.repository.ts";
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

const OUTBOX_DOWN = new Error("outbox unavailable");
const AGENT_STORE_DOWN = new Error("agent store unavailable");

class RecordingOutbox implements AgentRegistryDeliveryOutbox {
  readonly intents: AgentRegistryDeliveryIntent[] = [];
  readonly alerts: AgentRegistryAlertIntent[] = [];
  failNext = false;

  async record({ deliveries, alerts }: AgentRegistryFanOut): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw OUTBOX_DOWN;
    }
    this.intents.push(...deliveries);
    this.alerts.push(...alerts);
  }
}

function setup({
  agents = [connectedAgent("agent-1", "Field agent")],
  endpoints = [endpoint("hook-governance", ["governance.agent.*"])],
  traffic = [],
  organizationIds = [ORG],
  enterpriseOrganizationIds = organizationIds,
  now = () => NOW,
  deliveryOutbox,
}: {
  agents?: Agent[];
  endpoints?: WebhookEndpointView[];
  traffic?: TraceAgentSeen[];
  organizationIds?: string[];
  enterpriseOrganizationIds?: string[];
  now?: () => Instant;
  /** Replaces the recording outbox; `null` stands for the api, where no outbox runs. */
  deliveryOutbox?: AgentRegistryDeliveryOutbox | null;
} = {}) {
  const state: {
    agents: Agent[];
    failAgents: boolean;
    holdNextList?: Promise<void>;
    claimedTotal?: number;
    enterprise: Set<string>;
  } = {
    agents,
    failAgents: false,
    enterprise: new Set(enterpriseOrganizationIds),
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
      findAdministrators: async () => [],
    }),
    settings: MemoryAgentRegistrySettingsRepository.create(),
    traces: createApiFixture<TraceApi>({ findAgentsSeen: async () => traffic }),
    webhooks: createApiFixture<WebhookApi>({ getAll: async () => endpoints }),
    entitlements: {
      hasEnterprisePlan: async (organizationId) => state.enterprise.has(organizationId),
    },
    outbox: () => (deliveryOutbox === undefined ? outbox : (deliveryOutbox ?? undefined)),
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
      const { service, outbox, registry, state } = setup({
        agents: [],
        endpoints: [
          endpoint("hook-governance", ["governance.agent.*"]),
          endpoint("hook-gateway", ["gateway.*"]),
        ],
      });
      await service.reconcileOrganization({ organizationId: ORG });
      state.agents = [connectedAgent("agent-1", "Field agent")];

      await service.reconcileOrganization({ organizationId: ORG });

      const {
        events: [event],
      } = await registry.listEventsAfter({ organizationId: ORG, limit: 10 });
      expect(event?.type).toBe("governance.agent.registered");
      expect(outbox.intents.map((intent) => [intent.endpointId, intent.eventId])).toEqual([
        ["hook-governance", event?.id],
      ]);
    });
  });

  describe("when an event's push was never recorded", () => {
    /** @scenario An event whose push was not recorded is pushed by the next reconcile */
    it("records its intents on the next reconcile with nothing changed", async () => {
      const { service, outbox, state } = setup({ agents: [] });
      await service.reconcileOrganization({ organizationId: ORG });
      state.agents = [connectedAgent("agent-1", "Field agent")];
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

  describe("when a project trigger reaches an organisation with no baseline", () => {
    /** @scenario An organisation's first reconcile from any trigger is a silent baseline */
    it("records the existing agents silently, then pushes the next new agent", async () => {
      const existing = [
        connectedAgent("agent-1", "Field agent"),
        connectedAgent("agent-2", "Desk"),
      ];
      const { service, registry, outbox, state } = setup({
        agents: existing,
        endpoints: [endpoint("hook-governance", ["governance.*"])],
      });

      await service.reconcileOrganization({ organizationId: ORG });

      expect(outbox.intents).toHaveLength(0);
      await expect(registry.findEntries({ organizationId: ORG, limit: 10 })).resolves.toHaveLength(
        2,
      );

      state.agents = [...existing, connectedAgent("agent-3", "New agent")];
      await service.reconcileOrganization({ organizationId: ORG });

      expect(outbox.intents.map((intent) => intent.eventType)).toEqual([
        "governance.agent.registered",
      ]);
    });
  });

  describe("when an organisation upgrades to Enterprise and a walk reaches it", () => {
    /** @scenario An organisation's first reconcile after it upgrades to Enterprise is a silent baseline */
    it("records its agents silently, then pushes the next new agent", async () => {
      const existing = [
        connectedAgent("agent-1", "Field agent"),
        connectedAgent("agent-2", "Desk"),
      ];
      const { service, outbox, state } = setup({
        agents: existing,
        enterpriseOrganizationIds: [],
        endpoints: [endpoint("hook-governance", ["governance.*"])],
      });
      await service.reconcileTraffic({ everyOrganization: true });
      state.enterprise.add(ORG);

      await service.reconcileTraffic({ everyOrganization: true });

      expect(outbox.intents).toHaveLength(0);

      state.agents = [...existing, connectedAgent("agent-3", "New agent")];
      await service.reconcileTraffic({ everyOrganization: true });

      expect(outbox.intents.map((intent) => intent.eventType)).toEqual([
        "governance.agent.registered",
      ]);
    });
  });

  describe("when an organisation with no agents is baselined and then gains one", () => {
    /** @scenario An organisation baselined with no agents pushes its first agent */
    it("pushes the new agent", async () => {
      const { service, outbox, state } = setup({
        agents: [],
        endpoints: [endpoint("hook-governance", ["governance.*"])],
      });
      await service.reconcileOrganization({ organizationId: ORG });

      state.agents = [connectedAgent("agent-1", "Field agent")];
      await service.reconcileOrganization({ organizationId: ORG });

      expect(outbox.intents.map((intent) => intent.eventType)).toEqual([
        "governance.agent.registered",
      ]);
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

      const { events: feed } = await registry.listEventsAfter({ organizationId: ORG, limit: 10 });
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

      const { events: feed } = await registry.listEventsAfter({ organizationId: ORG, limit: 10 });
      expect(feed.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      expect(outbox.intents).toEqual([]);
      await expect(
        registry.findUndeliveredEvents({ organizationId: ORG, limit: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a stop's milestones are announced", () => {
    function stopOf(agentId: string, status: AgentStopView["status"]): AgentStopView {
      return {
        id: "agentstop-1",
        agentId,
        agentName: "Field agent",
        status,
        severity: "high",
        approval: "required",
        trigger: "user",
        reason: "leaking prices",
        requestedBy: { userId: "user-ops", apiKeyId: null },
        decidedByUserId: null,
        restoredByUserId: null,
        targets: [],
        requestedAt: "2026-11-12T00:00:00.000Z",
        decidedAt: null,
        quarantinedAt: null,
        restoreRequestedAt: null,
        restoredAt: null,
      };
    }

    /** When the milestone was reached, a minute before the announce runs at `NOW`. */
    const MILESTONE_AT = Date.parse("2026-11-11T23:59:00.000Z");

    const MILESTONES = [
      ["governance.agent.stop_requested", "pending_approval"],
      ["governance.agent.quarantined", "quarantined"],
      ["governance.agent.restored", "restored"],
    ] as const;

    /** @scenario A kill switch milestone is pushed to each subscribed webhook and written to no registry feed */
    it("records one intent per milestone and subscribed endpoint and appends no feed event", async () => {
      const { service, registry, outbox } = setup({
        endpoints: [
          endpoint("hook-governance", ["governance.agent.*"]),
          endpoint("hook-quarantine", ["governance.agent.quarantined"]),
          endpoint("hook-gateway", ["gateway.*"]),
        ],
      });
      await service.reconcileOrganization({ organizationId: ORG });
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 1 });
      if (!entry) throw new Error("no registry entry");

      for (const [milestone, status] of MILESTONES) {
        await service.announceStop({
          organizationId: ORG,
          eventId: `agentstop-1_${milestone}`,
          milestone,
          occurredAt: MILESTONE_AT,
          stop: stopOf(entry.id, status),
        });
      }

      expect(outbox.intents.map((intent) => [intent.endpointId, intent.eventType])).toEqual([
        ["hook-governance", "governance.agent.stop_requested"],
        ["hook-governance", "governance.agent.quarantined"],
        ["hook-quarantine", "governance.agent.quarantined"],
        ["hook-governance", "governance.agent.restored"],
      ]);
      const [body] = outbox.intents.map((intent) => intent.body);
      expect(body).toMatchObject({
        id: "agentstop-1_governance.agent.stop_requested",
        type: "governance.agent.stop_requested",
        agent_id: entry.id,
        agent: { id: entry.id },
        stop: { id: "agentstop-1", status: "pending_approval" },
        occurred_at: "2026-11-11T23:59:00.000Z",
      });
      expect(body).not.toHaveProperty("sequence");
      const feed = await registry.listEventsAfter({ organizationId: ORG, limit: 100 });
      const versions = await registry.listEventsOfEntry({
        organizationId: ORG,
        entryId: entry.id,
        limit: 100,
      });
      expect(feed.events.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      expect(versions.events.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      await expect(
        registry.findUndeliveredEvents({ organizationId: ORG, limit: 10 }),
      ).resolves.toEqual([]);
    });

    /** @scenario A redelivered kill switch milestone is pushed once */
    it("keeps one outbox intent per endpoint however often the milestone is announced", async () => {
      const processStore = InMemoryProcessStore.createForTesting();
      const { service, registry } = setup({
        deliveryOutbox: OutboxAgentRegistryDelivery.create(processStore),
      });
      await service.reconcileOrganization({ organizationId: ORG });
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 1 });
      if (!entry) throw new Error("no registry entry");
      const announce = () =>
        service.announceStop({
          organizationId: ORG,
          eventId: "agentstop-1_quarantined_0",
          milestone: "governance.agent.quarantined",
          occurredAt: MILESTONE_AT,
          stop: stopOf(entry.id, "quarantined"),
        });

      await Promise.all([announce(), announce()]);
      await announce();

      const messages = await processStore.findMessagesByRef({
        ref: {
          processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
          projectId: ORG,
          processKey: AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
        },
      });
      expect(messages.map((message) => message.messageKey)).toEqual([
        "agent-registry:agentstop-1_quarantined_0:hook-governance",
      ]);
    });

    /** @scenario A redelivered kill switch milestone is pushed once */
    it("stamps the moment the milestone was reached, so a later redelivery carries it too", async () => {
      let now = NOW;
      const { service, registry } = setup({ now: () => now });
      await service.reconcileOrganization({ organizationId: ORG });
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 1 });
      if (!entry) throw new Error("no registry entry");
      const announce = () =>
        service.announceStop({
          organizationId: ORG,
          eventId: "agentstop-1_quarantined_0",
          milestone: "governance.agent.quarantined",
          occurredAt: MILESTONE_AT,
          stop: stopOf(entry.id, "quarantined"),
        });

      const first = await announce();
      now = now.add({ minutes: 5 });
      const redelivered = await announce();

      expect(first.occurred_at).toBe("2026-11-11T23:59:00.000Z");
      expect(redelivered.occurred_at).toBe(first.occurred_at);
    });

    /** @scenario A redelivered kill switch milestone is pushed once */
    it("refuses where no outbox runs, so the announcement is retried rather than lost", async () => {
      const { service, registry } = setup({ deliveryOutbox: null });
      await service.reconcileOrganization({ organizationId: ORG });
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 1 });
      if (!entry) throw new Error("no registry entry");

      await expect(
        service.announceStop({
          organizationId: ORG,
          eventId: "agentstop-1_quarantined_0",
          milestone: "governance.agent.quarantined",
          occurredAt: MILESTONE_AT,
          stop: stopOf(entry.id, "quarantined"),
        }),
      ).rejects.toThrow(/outbox/);
    });
  });

  describe("when another release wrote an event of a type this release does not know", () => {
    /** Every event a reader pages through, one page at a time, as `sequence:type`. */
    async function readToEnd(
      read: (cursor: string | undefined) => Promise<AgentRegistryEventPage>,
    ): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const { data, next_cursor } = await read(cursor);
        seen.push(...data.map((event) => `${event.sequence}:${event.type}`));
        if (next_cursor === null) return seen;
        cursor = next_cursor;
      }
      throw new Error("the feed did not reach its end");
    }

    /** @scenario An event another release wrote with a type this release does not know is left out of the feed and versions */
    it("leaves it out of the feed, the versions and the push, and pages past it", async () => {
      const { service, reads, registry, outbox, state } = setup();
      await service.reconcileOrganization({ organizationId: ORG });
      const [entry] = await registry.findEntries({ organizationId: ORG, limit: 1 });
      if (!entry) throw new Error("no registry entry");
      await registry.applyChanges({
        organizationId: ORG,
        baselineAt: NOW,
        // Another release wrote it: its event type union held this one, so the cast stands for it.
        plan: () => ({
          writes: [],
          events: [
            {
              id: "foreign-1",
              type: "governance.agent.a_later_release_type" as AgentRegistryEventType,
              entryId: entry.id,
              fromVersion: null,
              toVersion: null,
              tool: null,
              occurredAt: NOW,
              agent: entry,
            },
          ],
        }),
      });
      state.agents = [...state.agents, connectedAgent("agent-2", "Desk agent")];
      await service.reconcileOrganization({ organizationId: ORG });

      const feed = await readToEnd((cursor) =>
        reads.listEvents({ organizationId: ORG, limit: 1, cursor }),
      );
      const versions = await readToEnd((cursor) =>
        reads.listVersions({ organizationId: ORG, id: entry.id, limit: 1, cursor }),
      );

      expect(feed).toEqual(["1:governance.agent.registered", "3:governance.agent.registered"]);
      expect(versions).toEqual(["1:governance.agent.registered"]);
      expect(outbox.intents.map((intent) => intent.eventType)).toEqual([
        "governance.agent.registered",
      ]);
    });
  });
});
