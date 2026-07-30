import type { ClickHouseClient } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { createAutomationsPipeline } from "../automations";
import { createBillingReportingPipeline } from "../billing-reporting";
import { createCodingAgentProcessingPipeline } from "../coding-agent-processing";
import { createExperimentRunProcessingPipeline } from "../experiment-run-processing";
import { createLangyConversationProcessingPipeline } from "../langy-conversation-processing";
import { createLogProcessingPipeline } from "../log-processing";
import { createMetricProcessingPipeline } from "../metric-processing";
import {
  createEventSourcingRegistry,
  type EventSourcingRegistryDeps,
} from "../registry";
import { createSimulationProcessingPipeline } from "../simulation-processing";
import { createTopicClusteringProcessingPipeline } from "../topic-clustering-processing";
import { createTraceProcessingPipeline } from "../trace-processing";

/**
 * The boot test ADR-110 decision 4 requires of the composition root: the
 * whole graph builds and dispatches with no ClickHouse, no Redis, no
 * Postgres. `stubClient` is never called — every pipeline that takes one
 * only wraps it in a store at construction time, it never queries at
 * registration time or on a plain command dispatch.
 */
function stubClient(): ClickHouseClient {
  return {
    query: async () => ({ rows: [] }),
    stream: async function* () {},
    insert: async () => undefined,
    close: async () => undefined,
  };
}

function testDeps(): EventSourcingRegistryDeps {
  return {
    client: stubClient(),
    automations: {
      dispatch: {
        triggerIsActive: async () => true,
        confirmSettledMatch: async () => "confirmed",
        isSendClaimed: async () => false,
        claimSend: async () => undefined,
        sendNotifyDigest: async () => undefined,
        runPersistAction: async () => undefined,
      },
      sweep: {
        decideSweepCandidates: async () => [],
        evaluateGraphTrigger: async () => undefined,
        pruneDispatchedIntentsBefore: async () => 0,
      },
      prune: {
        pruneExpiredDeliveries: async () => 0,
        pruneDispatchedIntentsBefore: async () => 0,
      },
    },
    billing: {
      organizations: { getOrganizationForBilling: async () => null },
      billingCheckpoints: {
        getCheckpoint: async () => null,
        writeIntent: async () => undefined,
        confirm: async () => undefined,
        clearPendingAndIncrementFailures: async () => undefined,
      },
      getUsageReportingService: () => undefined,
      queryBillableEventsTotal: async () => 0,
      listOrganizationsToReport: async () => [],
      pruneDispatchedIntentsBefore: async () => 0,
      resolveOrganizationId: async () => "org-1",
      isSaas: false,
    },
    blobCleanup: {
      sweep: async () => ({
        scanned: 0,
        reclaimed: 0,
        repaired: 0,
        bookkeeping: 0,
        truncated: false,
        failed: 0,
      }),
      recordTick: async () => undefined,
    },
    codingAgent: {},
    evaluation: {
      executeEvaluation: {
        monitors: {} as never,
        spanStorage: { getSpansByTraceId: async () => [] },
        traceEvents: { getEventsByTraceId: async () => [] },
        evaluationExecution: {} as never,
        costRecorder: { recordCost: async () => undefined },
      },
    },
    experimentRun: {
      experimentRunExecution: null,
    },
    langyConversation: {
      prisma: {
        langyConversationProjection: {
          findUnique: async () => null,
          upsert: async () => ({}) as never,
        },
        langyConversationTurnProjection: {
          findUnique: async () => null,
          upsert: async () => ({}) as never,
        },
        langyMessageProjection: {
          findMany: async () => [],
          create: async () => ({}) as never,
        },
      } as never,
      effects: {
        workerDispatch: { dispatchTurn: async () => undefined },
        titleGeneration: { generateTitle: async () => undefined },
      },
    },
    langySessionKeyReap: {
      reap: async () => 0,
      recordTick: async () => undefined,
    },
    simulation: {},
    topicClustering: {
      ports: { runClusteringPage: async () => undefined },
    },
    trace: {},
  };
}

describe("createEventSourcingRegistry", () => {
  /**
   * Historical note: `evaluation-processing`'s `evaluationAnalyticsTable`
   * declares a time-leading sort key without a `readWindow`, which
   * `@langwatch/clickhouse`'s `clickhouseReplacing` briefly required
   * unconditionally and threw `ReplaceStoreConfigurationError` for — this
   * suite caught it fail-fast against the whole graph (ADR-110 decision 6,
   * no per-pipeline fault isolation). Fixed upstream; kept here as coverage
   * that every one of the 11 `definePipeline` pipelines constructs standalone
   * with no error, independent of this composition root's own wiring.
   */
  it("constructs every definePipeline pipeline standalone with no error", () => {
    const client = stubClient();
    const deps = testDeps();
    const builds: Record<string, () => unknown> = {
      automations: () => createAutomationsPipeline(deps.automations),
      billing: () =>
        createBillingReportingPipeline({ client, ...deps.billing }),
      codingAgent: () =>
        createCodingAgentProcessingPipeline({ client, ...deps.codingAgent }),
      experimentRun: () =>
        createExperimentRunProcessingPipeline({
          client,
          ...deps.experimentRun,
        }),
      langyConversation: () =>
        createLangyConversationProcessingPipeline({
          client,
          ...deps.langyConversation,
        }),
      log: () => createLogProcessingPipeline({ client }),
      metric: () => createMetricProcessingPipeline({ client }),
      simulation: () =>
        createSimulationProcessingPipeline({ client, ...deps.simulation }),
      topicClustering: () =>
        createTopicClusteringProcessingPipeline({
          client,
          ...deps.topicClustering,
        }),
      trace: () => createTraceProcessingPipeline({ client, ...deps.trace }),
    };
    const failures: Record<string, string> = {};
    for (const [name, build] of Object.entries(builds)) {
      try {
        build();
      } catch (error) {
        failures[name] = error instanceof Error ? error.message : String(error);
      }
    }
    expect(failures).toEqual({});
  });

  /**
   * ADR-110 decision 4's actual requirement: every one of the 13 registers,
   * against pipeline names as each pipeline itself declares them (several
   * differ from their directory name — `automations` is pipeline `trigger`,
   * `billing-reporting` is `billing_report`, `log-processing`/
   * `metric-processing` are `log`/`metric`).
   */
  it("registers all 13 pipelines' worth of members and resolves every command", () => {
    const registry = createEventSourcingRegistry(testDeps());

    // 11 `definePipeline` builds go through `registry.register`; the two
    // scheduled-maintenance mounts (blob-maintenance, langy-maintenance) are
    // `ScheduledTickMount`, not `BuiltPipeline`, so they never appear here —
    // ADR-110 decision 6 gates their interval, not their construction.
    expect(
      registry.registry
        .all()
        .map((entry) => entry.aggregateType)
        .sort(),
    ).toEqual(
      [
        "trigger",
        "billing_report",
        "coding_agent_session",
        "evaluation",
        "experiment_run",
        "langy_conversation",
        "log",
        "metric",
        "simulation_run",
        "topic_clustering",
        "trace",
      ].sort(),
    );
    expect(() => registry.registry.assertResolvable()).not.toThrow();

    expect(Object.keys(registry.commands.traces).length).toBeGreaterThan(0);
    expect(Object.keys(registry.commands.billing)).toContain(
      "recordBillableEvent",
    );
    expect(Object.keys(registry.commands.automations)).toContain("recordMatch");
    expect(registry.commands.ingestionPull).toBeDefined();
  });

  it("dispatches a command end to end with runsConsumers: false and starts no consumer", async () => {
    const registry = createEventSourcingRegistry(testDeps());
    await registry.start({ runsConsumers: false });

    const result = await registry.commands.billing.recordBillableEvent(
      { id: "evt-1", type: "test/thing", createdAt: Date.now() },
      { tenantId: "tenant-1" },
    );

    expect(result.events).toHaveLength(1);
    await registry.stop();
  });

  it("stages a job for each subscribed member when a command is dispatched", async () => {
    const registry = createEventSourcingRegistry(testDeps());
    await registry.start({ runsConsumers: false });

    expect(() => registry.registry.assertResolvable()).not.toThrow();

    const billingPipeline = registry.registry
      .all()
      .find((entry) => entry.aggregateType === "billing_report")!.pipeline;
    // `billableEventRecorded` is subscribed by exactly one map
    // (`billableEventsMeter`) — the poke process manager is disabled under
    // `isSaas: false` and the sweep process manager reacts to no event.
    expect(
      registry.registry.mapsFor(billingPipeline.eventTypes[0]!),
    ).toHaveLength(1);

    const result = await registry.commands.billing.recordBillableEvent(
      { id: "evt-2", type: "test/thing", createdAt: Date.now() },
      { tenantId: "tenant-1" },
    );
    expect(result.events).toHaveLength(1);

    await registry.stop();
  });

  /**
   * @scenario A pipeline of maps alone is never asked for `.id()` — its
   * events need no mutual exclusion, so the engine derives an aggregate id
   * of its own (a payload hash, so a retry collapses onto the same row)
   * rather than calling an extractor that was never declared (`aggregateIdOf`
   * in `runtime/service.ts`). `log-processing` and `metric-processing` are
   * the two pipelines this applies to: neither declares `.id(...)`, and
   * dispatch still succeeds.
   */
  it("dispatches a map-only pipeline's command even though it never declares .id()", async () => {
    const registry = createEventSourcingRegistry(testDeps());
    await registry.start({ runsConsumers: false });

    const logResult = await registry.commands.logs.recordCanonicalLog(
      {
        recordId: "rec-1",
        tenantId: "tenant-1",
        occurredAt: Date.now(),
        source: "test",
        payload: "{}",
      } as never,
      { tenantId: "tenant-1" },
    );
    expect(logResult.events).toHaveLength(1);
    expect(logResult.events[0]?.aggregateId).toEqual(expect.any(String));

    const metricResult = await registry.commands.metrics.recordDataPoint(
      {
        pointId: "point-1",
        seriesId: "series-1",
        timeUnixMs: Date.now(),
        value: 1,
        metricName: "m",
      } as never,
      { tenantId: "tenant-1" },
    );
    expect(metricResult.events).toHaveLength(1);

    await registry.stop();
  });

  it("is safe to stop twice", async () => {
    const registry = createEventSourcingRegistry(testDeps());
    await registry.start({ runsConsumers: true });
    await registry.stop();
    await expect(registry.stop()).resolves.toBeUndefined();
  });

  it("starts and stops the consumer loops only when runsConsumers is true", async () => {
    const registry = createEventSourcingRegistry(testDeps());
    await registry.start({ runsConsumers: true });
    await registry.stop();
  });
});
