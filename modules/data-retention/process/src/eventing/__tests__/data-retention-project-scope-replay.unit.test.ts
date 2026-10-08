/**
 * @vitest-environment node
 * Spec: modules/data-retention/specs/data-retention-project-scope.feature
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  aggregateKey,
  type CutoffInfo,
  defineAggregate,
  definePipeline,
  EventSourcing,
  InMemoryProcessStore,
  type OccurredAtBounds,
  type ReplayEvent,
  type ReplayEventSource,
  ReplayService,
} from "@langwatch/eventing";
import { testEventSchema } from "@langwatch/eventing/testing";
import { OrganizationApi } from "@langwatch/organization-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_LIFECYCLE_PIPELINE_NAME,
  PROJECT_MOVED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestAuthz,
  createDataRetentionTestEntitlement,
  createDataRetentionTestOrganizations,
  createDataRetentionTestUsers,
} from "../../app/__tests__/data-retention.fixture.ts";
import { dataRetentionProcessModule } from "../../data-retention.module.ts";
import { dataRetentionProjectScopePeerEvents } from "../data-retention-project-scope.projection.ts";

const STEP_ID = "data-retention:replay-project-scope";
const BASE_MS = 1_700_000_000_000;
const ORGANIZATION = "organization-1";
const PROJECT = "project-1";

type Discovered = Awaited<ReturnType<ReplayEventSource["discoverAffectedAggregates"]>>[number];
type Matching = { eventTypes: readonly string[]; sinceMs?: number; tenantId?: string };
type OfAggregates = { tenantId: string; aggregateIds: string[]; eventTypes: readonly string[] };

/** Project's lifecycle log, answering the reads the replay engine makes. */
class SeededProjectLog implements ReplayEventSource {
  constructor(private readonly events: ReplayEvent[]) {}

  private matching({ eventTypes, sinceMs, tenantId }: Matching): ReplayEvent[] {
    return this.events.filter(
      (event) =>
        eventTypes.includes(event.type) &&
        (sinceMs === undefined || event.timestamp >= sinceMs) &&
        (tenantId === undefined || event.tenantId === tenantId),
    );
  }

  private ofAggregates(input: OfAggregates): ReplayEvent[] {
    return this.matching(input)
      .filter((event) => input.aggregateIds.includes(event.aggregateId))
      .toSorted((a, b) => a.timestamp - b.timestamp);
  }

  async discoverAffectedAggregates(input: Matching): Promise<Discovered[]> {
    const byKey = new Map<string, Discovered>();
    for (const event of this.matching(input)) {
      byKey.set(aggregateKey(event), {
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventTypes: [event.type],
      });
    }
    return [...byKey.values()];
  }

  async countEventsForAggregates(input: Matching): Promise<number> {
    return this.matching(input).length;
  }

  async getBoundedCutoffs(
    input: OfAggregates,
  ): Promise<{ cutoffs: Map<string, CutoffInfo>; occurredAtBounds: OccurredAtBounds | undefined }> {
    const cutoffs = new Map<string, CutoffInfo>();
    const selected = this.ofAggregates(input);
    for (const event of selected) {
      const current = cutoffs.get(aggregateKey(event));
      if (!current || event.timestamp > current.timestamp) {
        cutoffs.set(aggregateKey(event), { timestamp: event.timestamp, eventId: event.id });
      }
    }
    if (selected.length === 0) return { cutoffs, occurredAtBounds: undefined };
    const occurred = selected.map((event) => event.occurredAt);
    return {
      cutoffs,
      occurredAtBounds: { minMs: Math.min(...occurred), maxMs: Math.max(...occurred) },
    };
  }

  async streamEventsForAggregates(
    input: OfAggregates & {
      cutoffs: Map<string, CutoffInfo>;
      onEvent: (event: ReplayEvent) => void | Promise<void>;
    },
  ): Promise<{ eventsApplied: number }> {
    const selected = this.ofAggregates(input).filter((event) => {
      const cutoff = input.cutoffs.get(aggregateKey(event));
      return cutoff !== undefined && event.timestamp <= cutoff.timestamp;
    });
    for (const event of selected) await input.onEvent(event);
    return { eventsApplied: selected.length };
  }

  async loadAggregateEvents(
    input: OfAggregates & { maxCutoff: CutoffInfo; cursor?: CutoffInfo; batchSize: number },
  ): Promise<ReplayEvent[]> {
    return this.ofAggregates(input)
      .filter((event) => event.timestamp <= input.maxCutoff.timestamp)
      .filter((event) => input.cursor === undefined || event.timestamp > input.cursor.timestamp)
      .slice(0, input.batchSize);
  }
}

function fact({
  n,
  type,
  data,
}: {
  n: number;
  type: string;
  data: Record<string, unknown>;
}): ReplayEvent {
  const occurredAt = BASE_MS + n;
  return {
    id: `event-${n}`,
    aggregateId: PROJECT,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    tenantId: ORGANIZATION,
    createdAt: occurredAt,
    timestamp: occurredAt,
    occurredAt,
    type,
    version: "2026-10-06",
    idempotencyKey: `event-${n}`,
    data: {
      tenantId: ORGANIZATION,
      projectId: PROJECT,
      organizationId: ORGANIZATION,
      occurredAt,
      ...data,
    },
  };
}

const projectLog = [
  fact({ n: 1, type: PROJECT_CREATED_EVENT_TYPE, data: { teamId: "team-1", isPersonal: false } }),
  fact({
    n: 2,
    type: PROJECT_MOVED_EVENT_TYPE,
    data: { fromTeamId: "team-1", toTeamId: "team-2" },
  }),
];

/** Project's lifecycle pipeline as a stand-in owner, as a worker installing both registers it. */
function projectStandIn() {
  return definePipeline({
    name: PROJECT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents(
      dataRetentionProjectScopePeerEvents.map(({ type, data }) => testEventSchema(type, data)),
    )
    .build();
}

/** A worker installing data retention over memory stores, replaying over the seeded log. */
async function bootWorker() {
  const eventing = new EventSourcing({
    enabled: false,
    processStore: InMemoryProcessStore.createForTesting(),
    replayEngine: () => ({
      service: new ReplayService({
        eventSource: new SeededProjectLog(projectLog),
        redis: memoryRedisDouble({
          script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
        }),
      }),
      close: async () => undefined,
    }),
  });
  eventing.register(projectStandIn());
  const stores = memoryStores();
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));
  return bootInstalledProcess({
    role: "worker",
    modules: [dataRetentionProcessModule],
    config: {
      "data-retention": { platformDefaultDays: "49", isSaas: true, nodeEnvironment: "test" },
    },
    members: {
      tier: stores.tier,
      order: [...stores.order, "eventing"],
      read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
      close: async () => void 0,
    },
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    peers: [
      testPeer({ token: AuthzApi, instance: createDataRetentionTestAuthz() }),
      testPeer({ token: UserApi, instance: createDataRetentionTestUsers() }),
      testPeer({ token: EntitlementApi, instance: createDataRetentionTestEntitlement() }),
      testPeer({ token: OrganizationApi, instance: createDataRetentionTestOrganizations() }),
    ],
  });
}

describe("given a worker installing data retention over an empty fold and project's seeded log", () => {
  /** @scenario "The worker collects retention's project scope replay step and it fills an empty fold once" */
  it("collects the replay step by id, fills the fold from the log, and a second run writes nothing", async () => {
    const runtime = await bootWorker();
    const retention = runtime.service(DataRetentionApi);
    const saved: MigrationStepReport[] = [];
    const step = runtime.migrationSteps(isMigrationStep).find(({ id }) => id === STEP_ID);
    const pass = (resumeFrom: MigrationStepReport | null) =>
      step?.run({
        checkpoint: { resumeFrom, save: async ({ report }) => void saved.push(report) },
        dryRun: false,
        signal: new AbortController().signal,
      });

    try {
      expect(step).toMatchObject({ kind: "data", mode: "background" });
      await retention.setForScope({
        scope: { scopeType: "TEAM", scopeId: "team-2" },
        category: "traces",
        retentionDays: 63,
      });
      await expect(retention.getResolvedForProject({ projectId: PROJECT })).rejects.toMatchObject({
        code: "project_not_found",
      });

      const first = await pass(null);
      const resolved = await retention.getResolvedForProject({ projectId: PROJECT });
      const second = await pass(first ?? null);

      expect(first).toMatchObject({ aggregatesReplayed: 1, totalEvents: 2 });
      expect(resolved.traces).toBe(63);
      expect(second).toMatchObject({ aggregatesReplayed: 0 });
    } finally {
      await runtime.stop();
    }
  });
});
