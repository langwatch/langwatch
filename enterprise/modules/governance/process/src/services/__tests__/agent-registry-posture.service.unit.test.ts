/** Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature */
import type { AgentApi } from "@langwatch/agent-contract";
import {
  ARD_REGISTRY_ADAPTER_ID,
  AWS_BEDROCK_AGENTS_ADAPTER_ID,
  GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationAdministrator, OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import type { TraceAgentSeen, TraceApi } from "@langwatch/trace-contract";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type {
  AgentRegistryAlertIntent,
  AgentRegistryDeliveryIntent,
} from "../../features/registry/eventing/agent-registry-delivery.process.ts";
import {
  type AgentRegistryDeliveryOutbox,
  type AgentRegistryFanOut,
  AgentRegistryService,
} from "../../features/registry/services/agent-registry.service.ts";
import { MemoryAgentRegistrySettingsRepository } from "../../repositories/memory/memory.agent-registry-settings.repository.ts";
import { MemoryAgentRegistryRepository } from "../../repositories/memory/memory.agent-registry.repository.ts";
import { MemoryDiscoveredAgentRepository } from "../../repositories/memory/memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";

const ORG = "org-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const START = Temporal.Instant.from("2026-11-16T09:00:00Z");

function daysBefore(at: Instant, days: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(at.epochMilliseconds - days * DAY_MS);
}

class RecordingOutbox implements AgentRegistryDeliveryOutbox {
  readonly deliveries: AgentRegistryDeliveryIntent[] = [];
  readonly alerts: AgentRegistryAlertIntent[] = [];

  async record({ deliveries, alerts }: AgentRegistryFanOut): Promise<void> {
    this.deliveries.push(...deliveries);
    this.alerts.push(...alerts);
  }
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

function administrator(userId: string): OrganizationAdministrator {
  return { userId, name: null, email: `${userId}@acme.test` };
}

function setup({
  administrators = [administrator("admin-1")],
  endpoints = [endpoint("hook-governance", ["governance.agent.*"])],
}: {
  administrators?: OrganizationAdministrator[];
  endpoints?: WebhookEndpointView[];
} = {}) {
  const clock = { now: START };
  const state: { traffic: TraceAgentSeen[] } = { traffic: [] };
  const registry = MemoryAgentRegistryRepository.create();
  const settings = MemoryAgentRegistrySettingsRepository.create();
  const discoveredAgents = MemoryDiscoveredAgentRepository.create(
    MemoryDiscoveredPeopleStore.create(),
  );
  const outbox = new RecordingOutbox();
  const service = AgentRegistryService.create({
    registry,
    discoveredAgents,
    settings,
    agents: createApiFixture<AgentApi>({
      list: async () => ({
        data: [],
        pagination: { page: 1, limit: 200, total: 0, totalPages: 1 },
      }),
      platformUrl: ({ agentId }) => `https://app.langwatch.test/agents/${agentId}`,
    }),
    projects: createApiFixture<ProjectApi>({
      findLiveNonGovernanceIdsByOrganization: async () => ["project-1"],
      listNamesByIds: async () => [],
    }),
    organizations: createApiFixture<OrganizationApi>({
      findMembersWithDepartments: async () => [],
      listAllIds: async () => ({ ids: [ORG], next: null }),
      findAdministrators: async () => administrators,
    }),
    traces: createApiFixture<TraceApi>({
      findAgentsSeen: async ({ sinceMs }) =>
        state.traffic.filter((agent) => agent.lastSeenMs >= sinceMs),
    }),
    webhooks: createApiFixture<WebhookApi>({ getAll: async () => endpoints }),
    entitlements: { hasEnterprisePlan: async () => true },
    outbox: () => outbox,
    publicBaseUrl: "https://app.langwatch.test",
    logger: createTestLogger().logger,
    now: () => clock.now,
  });

  const list = async ({
    provider,
    rawAgentId,
    name,
    createdAt,
    matchIds = [],
  }: {
    provider: string;
    rawAgentId: string;
    name: string;
    createdAt: Instant;
    matchIds?: string[];
  }) =>
    discoveredAgents.recordAgentSighting({
      organizationId: ORG,
      provider,
      rawAgentId,
      displayText: name,
      metadata: {
        platform: "aws_bedrock",
        createdAt: createdAt.toString(),
        matchIds: JSON.stringify(matchIds),
      },
      seenAt: clock.now,
    });

  const trace = ({
    agentName,
    agentId,
    lastSeen = clock.now,
  }: {
    agentName: string;
    agentId: string | null;
    lastSeen?: Instant;
  }) => {
    state.traffic.push({
      agentName,
      agentId,
      model: null,
      spanCount: 4,
      firstSeenMs: lastSeen.epochMilliseconds - 60_000,
      lastSeenMs: lastSeen.epochMilliseconds,
    });
  };

  const entries = () => registry.findEntries({ organizationId: ORG, limit: 100 });
  const events = () => registry.findEventsAfter({ organizationId: ORG, limit: 100 });
  const reconcile = () => service.reconcileOrganization({ organizationId: ORG });
  return {
    service,
    registry,
    settings,
    outbox,
    clock,
    state,
    list,
    trace,
    entries,
    events,
    reconcile,
  };
}

describe("AgentRegistryService posture", () => {
  describe("given a listed Bedrock agent whose traces carry its id", () => {
    /** @scenario "A listed agent whose traces carry its id is governed" */
    it("keeps the entry governed, neither shadow nor dormant", async () => {
      const { list, trace, reconcile, entries } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/AGENT12345",
        name: "refund-bot",
        createdAt: daysBefore(START, 90),
        matchIds: ["AGENT12345"],
      });
      trace({ agentName: "refund-runner", agentId: "AGENT12345" });

      await reconcile();

      const held = await entries();
      expect(held.map((entry) => [entry.name, entry.source, entry.posture])).toEqual([
        ["refund-bot", "aws", "governed"],
      ]);
      expect(held[0]).toMatchObject({ shadow: false, dormant: false, platform: "aws_bedrock" });
    });
  });

  describe("given a traced agent no source lists", () => {
    /** @scenario "A traced agent no source lists is flagged shadow and announced once" */
    it("registers one shadow entry and appends one flagged_shadow event over two reconciles", async () => {
      const { trace, reconcile, entries, events } = setup();
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();
      await reconcile();

      const held = await entries();
      expect(held.map((entry) => [entry.name, entry.posture])).toEqual([["pricing-bot", "shadow"]]);
      const flagged = (await events()).filter(
        (event) => event.type === "governance.agent.flagged_shadow",
      );
      expect(flagged).toHaveLength(1);
    });
  });

  describe("given a listed reasoning engine and traces carrying its numeric id", () => {
    /** @scenario "A traced agent carrying a listed resource name is not shadow" */
    it("builds no shadow entry for the traced agent", async () => {
      const { list, trace, reconcile, entries } = setup();
      const name = "projects/acme-ml/locations/europe-west4/reasoningEngines/42";
      await list({
        provider: GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
        rawAgentId: name,
        name: "claims-agent",
        createdAt: daysBefore(START, 10),
        matchIds: [name, "42"],
      });
      trace({ agentName: "claims-runner", agentId: "42" });

      await reconcile();

      expect((await entries()).map((entry) => [entry.source, entry.shadow])).toEqual([
        ["gcp", false],
      ]);
    });
  });

  describe("given a listed AgentCore runtime created 90 days ago whose traffic stops", () => {
    /** @scenario "A listed agent with no traffic for the dormancy window is dormant" */
    it("versions the entry to dormant", async () => {
      const { list, trace, reconcile, entries, events, state, clock } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId:
          "arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/support_runtime-abc123",
        name: "support_runtime",
        createdAt: daysBefore(START, 90),
        matchIds: ["support_runtime-abc123"],
      });
      trace({ agentName: "support_runtime", agentId: "support_runtime-abc123" });
      await reconcile();
      expect((await entries())[0]?.posture).toBe("governed");

      state.traffic = [];
      clock.now = Temporal.Instant.fromEpochMilliseconds(START.epochMilliseconds + 60_000);
      await reconcile();

      const [entry] = await entries();
      expect(entry).toMatchObject({ dormant: true, posture: "dormant", version: 2 });
      const versioned = (await events()).filter(
        (event) => event.type === "governance.agent.versioned",
      );
      expect(versioned.map((event) => event.agent.posture)).toEqual(["dormant"]);
    });
  });

  describe("given a listed Bedrock agent created 3 days ago with no traffic", () => {
    /** @scenario "A listed agent younger than the dormancy window is not dormant" */
    it("keeps the entry governed", async () => {
      const { list, reconcile, entries } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/NEWAGENT01",
        name: "new-bot",
        createdAt: daysBefore(START, 3),
      });

      await reconcile();

      expect((await entries())[0]).toMatchObject({ dormant: false, posture: "governed" });
    });
  });

  describe("given an organisation whose dormancy window is 7 days", () => {
    /** @scenario "The organisation's dormancy window decides when an agent is dormant" */
    it("reads an agent last traced 10 days ago as dormant", async () => {
      const { list, trace, reconcile, entries, settings } = setup();
      await settings.saveDormantAfterDays({ organizationId: ORG, days: 7 });
      await list({
        provider: ARD_REGISTRY_ADAPTER_ID,
        rawAgentId: "urn:air:registry.acme.test:agent:triage",
        name: "triage",
        createdAt: daysBefore(START, 90),
      });
      trace({
        agentName: "triage-runner",
        agentId: "urn:air:registry.acme.test:agent:triage",
        lastSeen: daysBefore(START, 10),
      });

      await reconcile();

      expect((await entries())[0]).toMatchObject({ source: "ard", posture: "dormant" });
    });

    it("reads the same agent as governed under the default 30-day window", async () => {
      const { list, trace, reconcile, entries } = setup();
      await list({
        provider: ARD_REGISTRY_ADAPTER_ID,
        rawAgentId: "urn:air:registry.acme.test:agent:triage",
        name: "triage",
        createdAt: daysBefore(START, 90),
      });
      trace({
        agentName: "triage-runner",
        agentId: "urn:air:registry.acme.test:agent:triage",
        lastSeen: daysBefore(START, 10),
      });

      await reconcile();

      expect((await entries())[0]).toMatchObject({ posture: "governed" });
    });
  });

  describe("given a dormant listed agent", () => {
    /** @scenario "A dormant agent that gets traffic again is governed" */
    it("versions it back to governed once its id appears in traces", async () => {
      const { list, trace, reconcile, entries } = setup();
      await list({
        provider: AWS_BEDROCK_AGENTS_ADAPTER_ID,
        rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/AGENT12345",
        name: "refund-bot",
        createdAt: daysBefore(START, 90),
        matchIds: ["AGENT12345"],
      });
      await reconcile();
      expect((await entries())[0]?.posture).toBe("dormant");

      trace({ agentName: "refund-runner", agentId: "AGENT12345" });
      await reconcile();

      expect((await entries())[0]).toMatchObject({ dormant: false, posture: "governed" });
    });
  });

  describe("when a reconcile after the baseline flags a new shadow agent", () => {
    /** @scenario "A new shadow agent is pushed to every webhook subscribed to governance.agent.*" */
    it("requests one flagged_shadow delivery for the subscribed endpoint", async () => {
      const { trace, reconcile, outbox } = setup({
        endpoints: [
          endpoint("hook-governance", ["governance.agent.*"]),
          endpoint("hook-gateway", ["gateway.*"]),
        ],
      });
      await reconcile();
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();

      const flagged = outbox.deliveries.filter(
        (intent) => intent.eventType === "governance.agent.flagged_shadow",
      );
      expect(flagged.map((intent) => intent.endpointId)).toEqual(["hook-governance"]);
    });

    /** @scenario "A new shadow agent alerts each organisation admin once" */
    it("records one push alert per admin, keyed by the event and the admin", async () => {
      const { trace, reconcile, outbox, events } = setup({
        administrators: [administrator("admin-1"), administrator("admin-2")],
      });
      await reconcile();
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();
      await reconcile();

      const [flagged] = (await events()).filter(
        (event) => event.type === "governance.agent.flagged_shadow",
      );
      expect(outbox.alerts).toEqual([
        {
          organizationId: ORG,
          eventId: flagged?.id,
          userId: "admin-1",
          agentId: flagged?.agent_id,
          agentName: "pricing-bot",
        },
        {
          organizationId: ORG,
          eventId: flagged?.id,
          userId: "admin-2",
          agentId: flagged?.agent_id,
          agentName: "pricing-bot",
        },
      ]);
      expect(outbox.alerts.map((alert) => alert.userId)).not.toContain("member-1");
    });
  });

  describe("given an organisation the registry has not reconciled yet whose traces name a shadow agent", () => {
    /** @scenario "A silent baseline flags shadow agents without alerting" */
    it("registers the shadow entry and requests no push alert or webhook delivery", async () => {
      const { trace, reconcile, outbox, entries } = setup({
        administrators: [administrator("admin-1"), administrator("admin-2")],
      });
      trace({ agentName: "pricing-bot", agentId: "rogue-7" });

      await reconcile();

      expect((await entries()).map((entry) => entry.posture)).toEqual(["shadow"]);
      expect(outbox.alerts).toEqual([]);
      expect(outbox.deliveries).toEqual([]);
    });
  });
});
