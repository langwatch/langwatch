/**
 * @vitest-environment node
 * Spec: modules/entitlement/specs/usage.feature
 */
import { USAGE_PIPELINE_NAME } from "@langwatch/entitlement-contract";
import {
  defineAggregate,
  definePipeline,
  EventSourcing,
  InMemoryProcessStore,
  type ReplayEventSource,
  ReplayService,
} from "@langwatch/eventing";
import { testEventSchema } from "@langwatch/eventing/testing";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EntitlementModule } from "../../app/entitlement.app.ts";
import { entitlementProcessModule } from "../../entitlement.module.ts";
import {
  TRACE_METER_EVENT,
  TRACE_METER_PROJECTION_NAME,
} from "../../eventing/trace-meter.projection.ts";

const STEP_ID = "entitlement:seed-trace-meter";
const LANE = `${USAGE_PIPELINE_NAME}.${TRACE_METER_PROJECTION_NAME}`;
const DEPLOYED_AT = "2026-10-08T09:30:00.000Z";
const FIRST_OF_MONTH_MS = Date.parse("2026-10-01T00:00:00.000Z");

type Discovery = { eventTypes: readonly string[]; sinceMs?: number; tenantId?: string };

/** Trace's span log, empty of aggregates, recording what the replay engine asks it to discover. */
class RecordingSpanLog implements ReplayEventSource {
  readonly discoveries: Discovery[] = [];

  constructor(private readonly tenants?: readonly string[]) {}

  get discoverTenants(): ReplayEventSource["discoverTenants"] {
    const tenants = this.tenants;
    if (!tenants) return undefined;
    return async () => [...tenants];
  }
  async discoverAffectedAggregates(input: Discovery) {
    this.discoveries.push({
      eventTypes: input.eventTypes,
      sinceMs: input.sinceMs,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    });
    return [];
  }
  async countEventsForAggregates() {
    return 0;
  }
  async getBoundedCutoffs() {
    return { cutoffs: new Map(), occurredAtBounds: undefined };
  }
  async streamEventsForAggregates() {
    return { eventsApplied: 0 };
  }
  async loadAggregateEvents() {
    return [];
  }
}

/** Trace's span pipeline as a stand-in owner, as a worker installing both registers it. */
function traceStandIn() {
  return definePipeline({ name: "trace_processing", aggregate: defineAggregate({ type: "trace" }) })
    .withEvents([testEventSchema(TRACE_METER_EVENT.type, TRACE_METER_EVENT.data)])
    .build();
}

/** A worker installing entitlement whose eventing replays over the recording log. */
async function bootWorker({ log }: { log: RecordingSpanLog }) {
  const eventing = new EventSourcing({
    enabled: false,
    processStore: InMemoryProcessStore.createForTesting(),
    replayEngine: () => ({
      service: new ReplayService({
        eventSource: log,
        redis: memoryRedisDouble({
          script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
        }),
      }),
      close: async () => void 0,
    }),
  });
  eventing.register(traceStandIn());
  const stores = memoryStores();
  return bootInstalledProcess({
    role: "worker",
    modules: [entitlementProcessModule],
    config: { entitlement: { isSaas: false } },
    members: {
      tier: stores.tier,
      order: [...stores.order, "eventing"],
      read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
      close: async () => void 0,
    },
    peers: Object.values(EntitlementModule.dependencies).map((token) =>
      testPeer({ token, instance: createApiFixture() }),
    ),
  });
}

/** Boots a worker, runs the seed step once from nothing, and records every progress save. */
async function runSeed({ log }: { log: RecordingSpanLog }) {
  const runtime = await bootWorker({ log });
  const saves: MigrationStepReport[] = [];
  try {
    const step = runtime.migrationSteps(isMigrationStep).find(({ id }) => id === STEP_ID);
    const report = await step?.run({
      checkpoint: { resumeFrom: null, save: async ({ report }) => void saves.push(report) },
      dryRun: false,
      signal: new AbortController().signal,
    });
    return { step, report, saves };
  } finally {
    await runtime.stop();
  }
}

describe("given a worker installing entitlement over trace's span log", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(DEPLOYED_AT));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "The trace meter is seeded at deploy by replaying trace's spans" */
  it("declares the seed step, which replays the trace meter lane from trace's span log", async () => {
    const log = new RecordingSpanLog();

    const { step, report } = await runSeed({ log });

    expect(step).toMatchObject({ kind: "data", mode: "background" });
    expect(report).toMatchObject({ lane: LANE, aggregatesReplayed: 0 });
    expect(log.discoveries.map(({ eventTypes }) => eventTypes)).toEqual([
      [SPAN_RECEIVED_EVENT_TYPE],
    ]);
  });

  /** @scenario "The trace meter seed replays from the first of the current month at deploy" */
  it("replays from 1 October 00:00 UTC when deployed on 8 October", async () => {
    const log = new RecordingSpanLog();

    await runSeed({ log });

    expect(log.discoveries).toEqual([
      { eventTypes: [SPAN_RECEIVED_EVENT_TYPE], sinceMs: FIRST_OF_MONTH_MS },
    ]);
  });

  /** @scenario "The trace meter seed waits until no old writer remains" */
  it("declares the seed step as needing the old writers gone", async () => {
    const { step } = await runSeed({ log: new RecordingSpanLog() });

    expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
  });

  /** @scenario "The trace meter seed replays one tenant at a time and saves each tenant it completes" */
  it("discovers each tenant on its own and saves each one it completes", async () => {
    const log = new RecordingSpanLog(["tenant-a", "tenant-b"]);

    const { report, saves } = await runSeed({ log });

    expect(log.discoveries).toEqual([
      { eventTypes: [SPAN_RECEIVED_EVENT_TYPE], sinceMs: FIRST_OF_MONTH_MS, tenantId: "tenant-a" },
      { eventTypes: [SPAN_RECEIVED_EVENT_TYPE], sinceMs: FIRST_OF_MONTH_MS, tenantId: "tenant-b" },
    ]);
    const runCursor = report?.replayedThrough;
    expect(saves.filter((save) => "lastTenantDone" in save)).toEqual([
      expect.objectContaining({ lastTenantDone: "tenant-a", runReplaysThrough: runCursor }),
      expect.objectContaining({ lastTenantDone: "tenant-b", runReplaysThrough: runCursor }),
    ]);
  });
});
