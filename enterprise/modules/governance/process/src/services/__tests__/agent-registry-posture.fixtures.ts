// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** A registry with memory twins, recording outbox and scripted traces, for the posture tests. */
import type { AgentApi } from "@langwatch/agent-contract";
import type { OrganizationAdministrator, OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import type { TraceAgentSeen, TraceApi } from "@langwatch/trace-contract";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";

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

export const ORG = "org-1";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const START = Temporal.Instant.from("2026-11-16T09:00:00Z");

export function daysBefore(at: Instant, days: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(at.epochMilliseconds - days * DAY_MS);
}

export class RecordingOutbox implements AgentRegistryDeliveryOutbox {
  readonly deliveries: AgentRegistryDeliveryIntent[] = [];
  readonly alerts: AgentRegistryAlertIntent[] = [];

  async record({ deliveries, alerts }: AgentRegistryFanOut): Promise<void> {
    this.deliveries.push(...deliveries);
    this.alerts.push(...alerts);
  }
}

export function endpoint(id: string, enabledEvents: string[]): WebhookEndpointView {
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

export function administrator(userId: string): OrganizationAdministrator {
  return { userId, name: null, email: `${userId}@acme.test` };
}

export function setup({
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
  const events = async () =>
    (await registry.listEventsAfter({ organizationId: ORG, limit: 100 })).events;
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
