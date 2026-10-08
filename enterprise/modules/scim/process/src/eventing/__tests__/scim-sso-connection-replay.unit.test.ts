// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/scim/specs/scim-sso-connection-view.feature
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
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
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { scimProcessModule } from "../../scim.module.ts";
import { scimSsoConnectionPeerEvents } from "../scim-sso-connection.projection.ts";

const STEP_ID = "scim:replay-sso-connection-view";
const BASE_MS = 1_700_000_000_000;
const actor = { type: "user" as const, id: "user_ana" };

type Discovered = Awaited<ReturnType<ReplayEventSource["discoverAffectedAggregates"]>>[number];
type Matching = { eventTypes: readonly string[]; sinceMs?: number; tenantId?: string };
type OfAggregates = { tenantId: string; aggregateIds: string[]; eventTypes: readonly string[] };

/** Identity's connection log, answering the reads the replay engine makes. */
class SeededIdentityLog implements ReplayEventSource {
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
  return {
    id: `event-${n}`,
    aggregateId: "conn_okta",
    aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
    tenantId: "org_acme",
    createdAt: BASE_MS + n,
    timestamp: BASE_MS + n,
    occurredAt: BASE_MS + n,
    type,
    version: "2026-08-24",
    idempotencyKey: `event-${n}`,
    data,
  };
}

const identityLog = [
  fact({
    n: 1,
    type: CONNECTION_REGISTERED_EVENT_TYPE,
    data: {
      connectionId: "conn_okta",
      organizationId: "org_acme",
      type: "oidc",
      idp: { issuer: null, providerId: "Okta", clientIdRef: null, secretRef: null, certRefs: [] },
      arrivalPolicy: "refuse",
      actor,
      source: "self-serve",
    },
  }),
  fact({
    n: 2,
    type: CONNECTION_ACTIVATED_EVENT_TYPE,
    data: {
      connectionId: "conn_okta",
      testLoginAccountId: "account_1",
      actor,
      source: "self-serve",
    },
  }),
];

/** Identity's connection pipeline as a stand-in owner, as a worker installing both registers it. */
function identityStandIn() {
  return definePipeline({
    name: SSO_CONNECTION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SSO_CONNECTION_AGGREGATE_TYPE }),
  })
    .withEvents(scimSsoConnectionPeerEvents.map(({ type, data }) => testEventSchema(type, data)))
    .build();
}

/** A worker installing SCIM over memory stores, whose eventing replays over the seeded log. */
async function bootWorker() {
  const closed: string[] = [];
  const eventing = new EventSourcing({
    enabled: false,
    processStore: InMemoryProcessStore.createForTesting(),
    replayEngine: () => ({
      service: new ReplayService({
        eventSource: new SeededIdentityLog(identityLog),
        redis: memoryRedisDouble({
          script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
        }),
      }),
      close: async () => {
        closed.push("engine");
      },
    }),
  });
  eventing.register(identityStandIn());
  const stores = memoryStores();
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));
  const runtime = await bootInstalledProcess({
    role: "worker",
    modules: [scimProcessModule],
    config: { scim: { provenOffboarding: false } },
    members: {
      tier: stores.tier,
      order: [...stores.order, "eventing"],
      read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
      close: async () => void 0,
    },
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    peers: [
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
      testPeer({ token: EntitlementApi, instance: createApiFixture<EntitlementApi>() }),
      testPeer({ token: AuditLogApi, instance: createApiFixture<AuditLogApi>() }),
    ],
  });
  return { runtime, closed };
}

describe("given a worker installing SCIM over an empty connection view and identity's seeded log", () => {
  /** @scenario "The worker collects SCIM's connection view replay step and it fills an empty view once" */
  it("collects the replay step by id, fills the view from the log, and a second run writes nothing", async () => {
    const { runtime, closed } = await bootWorker();
    const scim = runtime.service(ScimApi);
    const saved: MigrationStepReport[] = [];
    const pass = (resumeFrom: MigrationStepReport | null) =>
      step?.run({
        checkpoint: { resumeFrom, save: async ({ report }) => void saved.push(report) },
        dryRun: false,
        signal: new AbortController().signal,
      });
    const step = runtime.migrationSteps(isMigrationStep).find(({ id }) => id === STEP_ID);

    try {
      expect(step).toMatchObject({ kind: "data", mode: "background" });
      await expect(scim.findConnections({ organizationId: "org_acme" })).resolves.toEqual([]);

      const first = await pass(null);
      const filled = await scim.findConnections({ organizationId: "org_acme" });
      const second = await pass(first ?? null);

      expect(first).toMatchObject({ aggregatesReplayed: 1, totalEvents: 2 });
      expect(filled).toEqual([
        { connectionId: "conn_okta", displayName: "Okta", type: "oidc", state: "ACTIVE" },
      ]);
      expect(second).toMatchObject({ aggregatesReplayed: 0 });
      await expect(scim.findConnections({ organizationId: "org_acme" })).resolves.toEqual(filled);
      expect(closed).toEqual(["engine", "engine"]);
    } finally {
      await runtime.stop();
    }
  });
});
