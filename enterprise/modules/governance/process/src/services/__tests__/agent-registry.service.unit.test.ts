/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { TraceApi, TraceAgentSeen } from "@langwatch/trace-contract";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { AgentRegistryDeliveryIntent } from "../../features/registry/eventing/agent-registry-delivery.process.ts";
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

class RecordingOutbox implements AgentRegistryDeliveryOutbox {
  readonly intents: AgentRegistryDeliveryIntent[] = [];
  failNext = false;

  async record(intents: readonly AgentRegistryDeliveryIntent[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("outbox unavailable");
    }
    this.intents.push(...intents);
  }
}

function setup({
  agents = [connectedAgent("agent-1", "Field agent")],
  endpoints = [endpoint("hook-governance", ["governance.agent.*"])],
  traffic = [],
  organizationIds = [ORG],
}: {
  agents?: Agent[];
  endpoints?: WebhookEndpointView[];
  traffic?: TraceAgentSeen[];
  organizationIds?: string[];
} = {}) {
  const state = { agents, failAgents: false };
  const registry = MemoryAgentRegistryRepository.create();
  const outbox = new RecordingOutbox();
  const reconciled: string[] = [];
  const service = AgentRegistryService.create({
    registry,
    discoveredAgents: MemoryGovernanceRepositories.create().discoveredAgents,
    agents: createApiFixture<AgentApi>({
      list: async ({ projectId }) => {
        if (state.failAgents) throw new Error("agent store unavailable");
        const data = state.agents.filter((agent) => agent.projectId === projectId);
        return { data, pagination: { page: 1, limit: 200, total: data.length, totalPages: 1 } };
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
    outbox: () => outbox,
    publicBaseUrl: "https://app.langwatch.test",
    logger: createTestLogger().logger,
    now: () => NOW,
  });
  return { service, registry, outbox, state, reconciled };
}

describe("AgentRegistryService", () => {
  describe("when reading the organisation's agents fails during a reconcile", () => {
    /** @scenario A source that cannot be read removes nothing */
    it("fails and leaves every entry's status and version as they were", async () => {
      const { service, registry, state } = setup();
      await service.reconcileOrganization({ organizationId: ORG });
      state.failAgents = true;

      await expect(service.reconcileOrganization({ organizationId: ORG })).rejects.toThrow(
        "agent store unavailable",
      );

      const entries = await registry.findEntries({ organizationId: ORG });
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
      await expect(service.reconcileOrganization({ organizationId: ORG })).rejects.toThrow(
        "outbox unavailable",
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

      await expect(service.reconcileHeldOrganizations()).resolves.toEqual({ organizations: 2 });
      expect(reconciled.toSorted()).toEqual([ORG, "org-2"]);
    });
  });
});
