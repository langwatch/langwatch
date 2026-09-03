import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  ingestionPullConfiguredEventSchema,
  ingestionPullRunCompletedEventSchema,
  type IngestionPullProcessingEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
} from "@langwatch/enterprise-governance-contract";
import {
  InMemoryProcessStore,
  buildProcessDefinition,
  buildProcessManager,
  createTenantId,
  type Event,
  type IntentContext,
  type ProcessDefinition,
  type ProcessEventEnvelope,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { IngestionPullEventingAdapter } from "../../adapters/ingestion-pull.adapter";
import { PulledUsageEventingAdapter } from "../../adapters/pulled-usage.adapter";
import {
  GatewayDebitPort,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayResolvedBudget,
  type GatewaySpendProcessingEvent,
} from "../gateway-debit.port";
import { GovernanceWebhookPort, type GovernanceWebhookSendBatch } from "../governance-webhook.port";
import {
  IngestionPullMetricsPort,
  IngestionPullOutcomePort,
  IngestionPullRunPort,
  IngestionPullSchedulePort,
} from "../ingestion-pull.port";
import { PulledUsageLedgerPort, type PulledUsageLedgerRow } from "../pulled-usage-ledger.port";
import {
  type IngestionPullRunStatusData,
  IngestionPullRunStatusEventingProjection,
} from "../../projections/ingestion-pull-run-status-eventing.projection";
import {
  type GatewayDebitsState,
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "../../processes/gateway-debit.process";
import { GovernanceEventDeliveryProcess } from "../../processes/governance-event-delivery.process";
import { GovernanceEventDeliveryIntent } from "../../intents/governance-event-delivery.intent";
import {
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessState,
  IngestionPullProcess,
} from "../../processes/ingestion-pull.process";
import { IngestionPullService } from "../../services/ingestion-pull.service";
import { PulledUsageLedgerIntent } from "../../intents/pulled-usage-ledger.intent";
import {
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "../../adapters/governance-events.adapter";

class FixedSchedule extends IngestionPullSchedulePort {
  nextRunAt(input: { cron: string; after: number }): number {
    return input.after + 15 * 60_000;
  }
}

class UnusedPull extends IngestionPullRunPort {
  run(): Promise<{ nextCursor: string | null; eventCount: number }> {
    return Promise.reject(new Error("unused"));
  }
}

class UnusedOutcome extends IngestionPullOutcomePort {
  completed(): Promise<void> {
    return Promise.resolve();
  }
  failed(): Promise<void> {
    return Promise.resolve();
  }
}

class UnusedMetrics extends IngestionPullMetricsPort {
  count(): void {}
  observeDuration(): void {}
}

class FailingPull extends IngestionPullRunPort {
  constructor(private readonly error: Error) {
    super();
  }

  async run(): Promise<{ nextCursor: string | null; eventCount: number }> {
    throw this.error;
  }
}

class RecordingPullOutcome extends IngestionPullOutcomePort {
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

class RecordingPullMetrics extends IngestionPullMetricsPort {
  readonly counts: string[] = [];
  readonly durations: number[] = [];

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    this.counts.push(outcome);
  }

  observeDuration(durationMs: number): void {
    this.durations.push(durationMs);
  }
}

class RecordingPulledUsageLedger extends PulledUsageLedgerPort {
  readonly rows: PulledUsageLedgerRow[] = [];
  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    this.rows.push(...rows);
    return Promise.resolve();
  }
}

class RecordingGatewayDebitPort extends GatewayDebitPort {
  readonly inserted: GatewayBudgetDebitRow[] = [];
  readonly crossings: GatewayBudgetCrossingCandidate[] = [];
  readonly updates: string[] = [];
  budgets: GatewayResolvedBudget[] = [];

  resolve(): Promise<GatewayResolvedBudget[]> {
    return Promise.resolve(this.budgets);
  }
  insert(rows: GatewayBudgetDebitRow[]): Promise<void> {
    this.inserted.push(...rows);
    return Promise.resolve();
  }
  detectCrossings(rows: GatewayBudgetCrossingCandidate[]): Promise<void> {
    this.crossings.push(...rows);
    return Promise.resolve();
  }
  shouldEmitBudgetUpdated(): Promise<boolean> {
    return Promise.resolve(true);
  }
  emitBudgetUpdated(input: { gatewayRequestId: string }): Promise<void> {
    this.updates.push(input.gatewayRequestId);
    return Promise.resolve();
  }
}

class RecordingGovernanceWebhookPort extends GovernanceWebhookPort {
  readonly processStore = InMemoryProcessStore.createForTesting();
  readonly maxAttempts = 11;
  readonly batches: GovernanceWebhookSendBatch[] = [];
  enabled = true;
  endpointIds = ["endpoint-1"];

  webhooksEnabled(): Promise<boolean> {
    return Promise.resolve(this.enabled);
  }
  activeEndpointIds(): Promise<string[]> {
    return Promise.resolve(this.endpointIds);
  }
  sendBatch(payload: GovernanceWebhookSendBatch, _context: IntentContext): Promise<void> {
    this.batches.push(payload);
    return Promise.resolve();
  }
  retryDelayMs(input: { attempt: number }): number {
    return input.attempt * 1_000;
  }
  now(): number {
    return 10_000;
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
      costNanoUsd,
      rateVersion: "v1",
      costBasis: "computed" as const,
      costStatus: "estimate" as const,
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

describe("governance signal eventing", () => {
  /** @scenario "Governance signals remain idempotent at the event store" */
  it("keeps virtual-key lifecycle appends ordered and idempotent per subject", async () => {
    const data = {
      tenantId: "project-1",
      organization_id: "org-1",
      virtual_key_id: "key-1",
      action: "rotated" as const,
      name: "Production key",
      display_prefix: "lw_vk_",
      reason: null,
      occurred_at: 1_000,
    };
    const [event] = await new RecordVkLifecycleCommand().handle({
      type: "lw.governance.record_vk_lifecycle",
      tenantId: createTenantId("project-1"),
      aggregateId: "vk:key-1",
      data,
    });

    expect(event).toMatchObject({
      aggregateId: "vk:key-1",
      type: GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
      idempotencyKey: "project-1:vk:key-1:rotated:1000",
    });
  });

  /** @scenario "Governance signals remain idempotent at the event store" */
  it("keys a budget crossing once per bucket, kind, and billing period", async () => {
    const data = {
      tenantId: "project-1",
      organization_id: "org-1",
      budget_id: "budget-1",
      kind: "breached" as const,
      scope_type: "project",
      bucket_scope_id: "project-1",
      end_user_id: null,
      virtual_key_id: null,
      anchor_project_id: "project-1",
      window: "month",
      period_started_at_ms: 0,
      limit_usd: "20",
      spent_usd: "20.01",
      on_breach: "block" as const,
      occurred_at: 1_000,
    };
    const [event] = await new RecordBudgetCrossingCommand().handle({
      type: "lw.governance.record_budget_crossing",
      tenantId: createTenantId("project-1"),
      aggregateId: "budget:budget-1",
      data,
    });

    expect(event).toMatchObject({
      aggregateId: "budget:budget-1",
      type: GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
      idempotencyKey: "project-1:budget:budget-1:project-1:breached:0",
    });
  });
});

describe("ingestion pull process and projection", () => {
  const process = IngestionPullProcess.create({
    schedule: new FixedSchedule(),
    execution: IngestionPullService.create(
      new UnusedPull(),
      new UnusedOutcome(),
      new UnusedMetrics(),
    ),
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
      tryLoad: async () => null,
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
    const service = IngestionPullService.create(
      new FailingPull(new Error("provider unavailable")),
      outcome,
      metrics,
      { clock: () => 2_000 },
    );
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

describe("gateway debit process", () => {
  it("stashes an unattributed outcome and releases it when admission arrives", () => {
    const port = new RecordingGatewayDebitPort();
    const service = GatewayDebitProcess.create(port);
    const definition = buildProcessDefinition(
      buildProcessManager<GatewaySpendProcessingEvent>({
        name: GATEWAY_DEBITS_PROCESS_NAME,
        applier: service.processManager(),
      }).config,
    ) as ProcessDefinition<GatewayDebitsState>;
    const ref = {
      processName: GATEWAY_DEBITS_PROCESS_NAME,
      projectId: "project-1",
      processKey: "request-1",
    };
    const outcome = definition.evolve({
      previousState: definition.initialState,
      ref,
      input: {
        kind: "event",
        now: 2_000,
        event: processEvent("lw.gateway.spend.confirmed", {
          gateway_request_id: "request-1",
          organization_id: "",
          team_id: "",
          virtual_key_id: "",
          principal_user_id: "",
          end_user_id: "",
          model: "model-1",
          model_provider_id: "provider-1",
          usage: {
            input_tokens: 1,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation_1h_tokens: 0,
            reasoning_tokens: 0,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            input_chars: 0,
            audio_ms: 0,
          },
          cost_nano_usd: 10,
          rate_version: "v1",
          duration_ms: 1,
          occurred_at: 1_000,
        }),
      },
    });
    expect(outcome.intents).toEqual([]);
    expect(outcome.state.pendingOutcome?.cost_nano_usd).toBe(10);
    const admitted = definition.evolve({
      previousState: outcome.state,
      ref,
      input: {
        kind: "event",
        now: 2_100,
        event: processEvent("lw.gateway.spend.admitted", {
          gateway_request_id: "request-1",
          organization_id: "org-1",
          team_id: "team-1",
          virtual_key_id: "key-1",
          principal_user_id: "user-1",
          end_user_id: "end-1",
          outcome_carries_attribution: false,
        }),
      },
    });
    expect(admitted.intents[0]?.messageKey).toContain("debits:late");
    expect(admitted.intents[0]?.payload).toMatchObject({
      organization_id: "org-1",
      cost_nano_usd: 10,
    });
  });
});

describe("governance webhook delivery", () => {
  it("uses deterministic envelopes and redelivery commits one endpoint send", async () => {
    const port = new RecordingGovernanceWebhookPort();
    const intent = GovernanceEventDeliveryIntent.create(port);
    const envelope = GovernanceEventDeliveryProcess.budgetCrossingEnvelope({
      tenantId: "project-1",
      organization_id: "org-1",
      budget_id: "budget-1",
      kind: "breached",
      scope_type: "PROJECT",
      bucket_scope_id: "project-1",
      end_user_id: null,
      virtual_key_id: null,
      anchor_project_id: "project-1",
      window: "MONTH",
      period_started_at_ms: 1_000,
      limit_usd: "10",
      spent_usd: "12",
      on_breach: "block",
      occurred_at: 2_000,
    });
    const payload = {
      organization_id: "org-1",
      project_id: "project-1",
      event_type: envelope.type,
      envelope,
    };
    const context = { projectId: "project-1", attempt: 1 } as IntentContext;
    await intent.deliver(payload, context);
    await intent.deliver(payload, context);
    const ref = {
      processName: "governanceEventsDelivery",
      projectId: "project-1",
      processKey: "endpoint:endpoint-1",
    };
    const messages = await port.processStore.findMessagesByRef({ ref });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageKey).toBe(`send:endpoint-1:${envelope.id}`);
    expect(envelope.data).toMatchObject({
      scope_type: "project",
      window: "month",
      on_breach: "block",
    });
  });
});
