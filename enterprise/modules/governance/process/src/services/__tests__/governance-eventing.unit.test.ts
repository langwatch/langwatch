import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  ingestionPullConfiguredEventSchema,
  ingestionPullRunCompletedEventSchema,
  type IngestionPullProcessingEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  buildProcessDefinition,
  buildProcessManager,
  createTenantId,
  type Event,
  type ProcessDefinition,
  type ProcessEventEnvelope,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusEventingProjection,
} from "../../eventing/ingestion-pull-run-status-eventing.projection.ts";
import { IngestionPullEventingAdapter } from "../../eventing/ingestion-pull.pipeline.ts";
import {
  type IngestionPullScheduler,
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessState,
  IngestionPullProcess,
} from "../../eventing/ingestion-pull.process.ts";
import { PulledUsageLedgerIntent } from "../../eventing/pulled-usage-ledger.intent.ts";
import { PulledUsageEventingAdapter } from "../../eventing/pulled-usage.pipeline.ts";
import type {
  PulledUsageLedgerRepository,
  PulledUsageLedgerRow,
} from "../../repositories/pulled-usage-ledger.repository.ts";
import { IngestionPullListingService } from "../ingestion-pull-listing.service.ts";
import type { IngestionPullMetricsSink } from "../ingestion-pull-metrics.service.ts";
import {
  type IngestionPullOutcomeChannel,
  type IngestionPullRunner,
  IngestionPullService,
} from "../ingestion-pull.service.ts";

class FixedSchedule implements IngestionPullScheduler {
  nextRunAt(input: { cron: string; after: number }): number {
    return input.after + 15 * 60_000;
  }
}

class UnusedPull implements IngestionPullRunner {
  run(): Promise<{ nextCursor: string | null; eventCount: number }> {
    return Promise.reject(new Error("unused"));
  }
}

class UnusedOutcome implements IngestionPullOutcomeChannel {
  completed(): Promise<void> {
    return Promise.resolve();
  }
  failed(): Promise<void> {
    return Promise.resolve();
  }
}

class UnusedMetrics implements IngestionPullMetricsSink {
  count(): void {}
  observeDuration(): void {}
}

class FailingPull implements IngestionPullRunner {
  constructor(private readonly error: Error) {}

  async run(): Promise<{ nextCursor: string | null; eventCount: number }> {
    throw this.error;
  }
}

class RecordingPullOutcome implements IngestionPullOutcomeChannel {
  readonly completedCalls = vi.fn();
  readonly failedCalls = vi.fn();

  async completed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    nextCursor: string | null;
    eventCount: number;
  }): Promise<void> {
    this.completedCalls(input);
  }

  async failed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    error: string;
    errorCode: string;
    retryable: false;
  }): Promise<void> {
    this.failedCalls(input);
  }
}

class RecordingPullMetrics implements IngestionPullMetricsSink {
  readonly counts: string[] = [];
  readonly durations: number[] = [];

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    this.counts.push(outcome);
  }

  observeDuration(durationMs: number): void {
    this.durations.push(durationMs);
  }
}

class RecordingPulledUsageLedger implements PulledUsageLedgerRepository {
  readonly rows: PulledUsageLedgerRow[] = [];
  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    this.rows.push(...rows);
    return Promise.resolve();
  }
}

function processEvent(
  eventType: string,
  payload: ProcessEventEnvelope["payload"],
  occurredAt = 1_000,
): ProcessEventEnvelope {
  return {
    eventId: `${eventType}:${occurredAt}`,
    eventType,
    occurredAt,
    tenantId: "project-1",
    projectId: "project-1",
    processKey: "key-1",
    payload,
  };
}

describe("governance Eventing adapters", () => {
  it("validates ingestion cron and preserves deterministic command identity", async () => {
    const Handler = IngestionPullEventingAdapter.commandHandlers().configure;
    const invalid = Handler.schema.validate({
      tenantId: createTenantId("project-1"),
      occurredAt: 1_000,
      sourceId: "source-1",
      configVersion: "v1",
      cursor: null,
      cron: "not a cron",
    });
    expect(invalid.success).toBe(false);

    const data = {
      tenantId: createTenantId("project-1"),
      occurredAt: 1_000,
      sourceId: "source-1",
      configVersion: "v1",
      cursor: null,
      cron: "*/15 * * * *",
    };
    const [event] = await new Handler().handle({
      type: "lw.obs.ingestion_pull.configure",
      tenantId: createTenantId("project-1"),
      aggregateId: "source-1",
      data,
    });
    expect(event).toMatchObject({
      aggregateId: "source-1",
      idempotencyKey: "source-1:ingestion_pull:configure:v1",
    });
  });

  it("keeps pulled corrections on one stream with distinct observation keys", async () => {
    const Handler = PulledUsageEventingAdapter.commandHandlers().recordPulledUsage;
    const observation = (costNanoUsd: number, observedAtMs: number) => ({
      tenantId: createTenantId("project-1"),
      occurredAt: 1_000,
      itemKey: "item-1",
      restatementKey: "restatement-1",
      source: "provider",
      ingestionSourceId: "source-1",
      organizationId: "org-1",
      teamId: "team-1",
      projectId: null,
      model: "model-1",
      tokensInput: 1,
      tokensOutput: 2,
      tokensCacheRead: 3,
      tokensCacheWrite: 4,
      costNanoMinor: costNanoUsd,
      currencyCode: "USD",
      costNanoUsd,
      rateVersion: "v1",
      costBasis: "computed" as const,
      costStatus: "estimate" as const,
      rawActorId: "",
      agentId: "",
      occurredAtMs: 1_000,
      observedAtMs,
    });
    const first = (
      await new Handler().handle({
        type: "lw.obs.pulled_usage.record",
        tenantId: createTenantId("project-1"),
        aggregateId: "restatement-1",
        data: observation(10, 1_000),
      })
    )[0];
    const correction = (
      await new Handler().handle({
        type: "lw.obs.pulled_usage.record",
        tenantId: createTenantId("project-1"),
        aggregateId: "restatement-1",
        data: observation(12, 2_000),
      })
    )[0];
    expect(first?.aggregateId).toBe("restatement-1");
    expect(correction?.aggregateId).toBe("restatement-1");
    expect(correction?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });
});

describe("ingestion pull process and projection", () => {
  const process = IngestionPullProcess.create({
    schedule: new FixedSchedule(),
    execution: IngestionPullService.create({
      runPort: new UnusedPull(),
      outcomePort: new UnusedOutcome(),
      metrics: new UnusedMetrics(),
    }),
    listing: IngestionPullListingService.create({
      sources: { findById: () => Promise.reject(new Error("unused")) },
      agents: { syncFromSource: () => Promise.reject(new Error("unused")) },
      people: { syncFromSource: () => Promise.reject(new Error("unused")) },
      outcomes: {
        agentsListed: () => Promise.reject(new Error("unused")),
        agentsListingRefused: () => Promise.reject(new Error("unused")),
        peopleListed: () => Promise.reject(new Error("unused")),
        peopleListingRefused: () => Promise.reject(new Error("unused")),
      },
    }),
  });
  const definition = buildProcessDefinition(
    buildProcessManager<IngestionPullProcessingEvent & Event>({
      name: INGESTION_PULL_PROCESS_NAME,
      applier: process.processManager(),
    }).config,
  ) as ProcessDefinition<IngestionPullProcessState>;
  const ref = {
    processName: INGESTION_PULL_PROCESS_NAME,
    projectId: "project-1",
    processKey: "source-1",
  };

  /** @scenario "Pull outcomes cannot regress the projected cursor" */
  it("does not let a superseded completion regress the process cursor", () => {
    const state: IngestionPullProcessState = {
      sourceId: "source-1",
      enabled: true,
      cron: "*/15 * * * *",
      cursor: "live",
      currentRun: { runId: "run-2", scheduledFor: 2_000, startedAt: 2_000 },
    };
    const result = definition.evolve({
      previousState: state,
      ref,
      input: {
        kind: "event",
        event: processEvent(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED, {
          sourceId: "source-1",
          runId: "run-1",
          scheduledFor: 1_000,
          nextCursor: "stale",
          eventCount: 1,
        }),
        now: 3_000,
      },
    });
    expect(result.state.cursor).toBe("live");
    expect(result.state.currentRun?.runId).toBe("run-2");
  });

  it("holds the cursor until the durable retry budget is exhausted", () => {
    const state: IngestionPullProcessState = {
      sourceId: "source-1",
      enabled: true,
      cron: "*/15 * * * *",
      cursor: "held",
      currentRun: { runId: "run-1", scheduledFor: 1_000, startedAt: 1_000 },
    };
    const result = definition.evolve({
      previousState: state,
      ref,
      input: {
        kind: "event",
        event: processEvent(INGESTION_PULL_EVENT_TYPES.RUN_FAILED, {
          sourceId: "source-1",
          runId: "run-1",
          scheduledFor: 1_000,
          error: "deadline exceeded",
          errorCode: "pull_failed",
          retryable: false,
        }),
        now: 2_000,
      },
    });

    expect(result.state).toMatchObject({ cursor: "held", currentRun: null });
    expect(result.nextWakeAt).toBe(902_000);
  });

  /** @scenario "Pull outcomes cannot regress the projected cursor" */
  it("does not let an older projected completion regress the run cursor", () => {
    const projection = IngestionPullRunStatusEventingProjection.create({
      get: async () => ({ kind: "empty" as const }),
      store: async () => undefined,
    } as StateProjectionStore<IngestionPullRunStatusData>);
    const configured = ingestionPullConfiguredEventSchema.parse({
      id: "configured",
      aggregateId: "source-1",
      aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
      tenantId: "project-1",
      createdAt: 1_000,
      occurredAt: 1_000,
      type: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
      version: INGESTION_PULL_EVENT_VERSIONS.CONFIGURED,
      data: {
        sourceId: "source-1",
        cron: "*/15 * * * *",
        configVersion: "v1",
        cursor: "A",
      },
    });
    const newer = ingestionPullRunCompletedEventSchema.parse({
      ...configured,
      id: "newer",
      occurredAt: 2_100,
      type: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
      version: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
      data: {
        sourceId: "source-1",
        runId: "run-2",
        scheduledFor: 2_000,
        nextCursor: "B",
        eventCount: 5,
      },
    });
    const older = ingestionPullRunCompletedEventSchema.parse({
      ...newer,
      id: "older",
      occurredAt: 2_200,
      data: {
        sourceId: "source-1",
        runId: "run-1",
        scheduledFor: 1_000,
        nextCursor: "stale",
        eventCount: 1,
      },
    });
    const live = projection.apply(projection.apply(projection.init(), configured), newer);
    expect(projection.apply(live, older)).toMatchObject({
      Cursor: "B",
      LastRunEventCount: 5,
      LastRunScheduledFor: 2_000,
    });
  });
});

describe("ingestion pull retry outcomes", () => {
  it("redelivers a failed window, then records one terminal durable failure", async () => {
    const outcome = new RecordingPullOutcome();
    const metrics = new RecordingPullMetrics();
    const service = IngestionPullService.create({
      runPort: new FailingPull(new Error("provider unavailable")),
      outcomePort: outcome,
      metrics,
      options: { clock: () => 2_000 },
    });
    const pull = {
      sourceId: "source-1",
      runId: "run-1",
      scheduledFor: 1_000,
      cursor: "held",
    };

    await expect(service.execute({ tenantId: "project-1", attempt: 1, pull })).rejects.toThrow(
      "provider unavailable",
    );
    expect(outcome.failedCalls).not.toHaveBeenCalled();
    expect(metrics.counts).toEqual(["failed_retryable"]);

    await expect(
      service.execute({ tenantId: "project-1", attempt: 3, pull }),
    ).resolves.toBeUndefined();
    expect(outcome.failedCalls).toHaveBeenCalledWith({
      tenantId: "project-1",
      occurredAt: 2_000,
      sourceId: "source-1",
      runId: "run-1",
      scheduledFor: 1_000,
      error: "provider unavailable",
      errorCode: "pull_failed",
      retryable: false,
      retryAfterMs: null,
    });
    expect(metrics.counts).toEqual(["failed_retryable", "failed_final"]);
  });
});

describe("pulled usage ledger process", () => {
  it("writes integer nano-USD and all quantities without changing scope", async () => {
    const ledger = new RecordingPulledUsageLedger();
    const intent = PulledUsageLedgerIntent.create(ledger);
    await intent.execute({
      restatement_key: "restatement-1",
      tenant_id: "project-1",
      scope_id: "team-1",
      organization_id: "org-1",
      team_id: "team-1",
      model: "model-1",
      cost_nano_usd: 12_345_678_901,
      tokens_input: 1,
      tokens_output: 2,
      tokens_cache_read: 3,
      tokens_cache_write: 4,
      occurred_at_ms: 1_000,
      observed_at_ms: 2_000,
    });
    expect(ledger.rows[0]).toMatchObject({
      tenantId: "project-1",
      scopeId: "team-1",
      amountNanoUsd: 12_345_678_901,
      tokensCacheWrite: 4,
    });
  });
});
