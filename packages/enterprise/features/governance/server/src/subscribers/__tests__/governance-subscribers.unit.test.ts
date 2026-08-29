import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { GovernanceKpisSubscriber } from "../governance-kpis.subscriber";
import { GovernanceOcsfSubscriber } from "../governance-ocsf.subscriber";
import {
  GovernanceKpiContributionPort,
  GovernanceOcsfEventPort,
  GovernanceSubscriberDiagnosticsPort,
  TraceAlertMetricsPort,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerPort,
  type GovernanceKpiContribution,
  type GovernanceOcsfEvent,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
  type TraceAlertTrigger,
} from "../../ports/governance-subscriber.port";
import { TraceAlertTriggerMatchSubscriber } from "../trace-alert-trigger-match.subscriber";

class RecordingKpis extends GovernanceKpiContributionPort {
  readonly rows: GovernanceKpiContribution[] = [];
  insertContribution(row: GovernanceKpiContribution): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

class RecordingOcsf extends GovernanceOcsfEventPort {
  readonly rows: GovernanceOcsfEvent[] = [];
  insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

class RecordingDiagnostics extends GovernanceSubscriberDiagnosticsPort {
  readonly warnings: string[] = [];
  readonly errors: unknown[] = [];
  warn(input: { code: string }): void {
    this.warnings.push(input.code);
  }
  capture(error: unknown): void {
    this.errors.push(error);
  }
}

class FixedTriggers extends TraceAlertTriggerPort {
  constructor(private readonly triggers: TraceAlertTrigger[]) {
    super();
  }
  activeForProject(): Promise<TraceAlertTrigger[]> {
    return Promise.resolve(this.triggers);
  }
}

class RecordingMatches extends TraceAlertTriggerMatchPort {
  readonly inputs: Parameters<TraceAlertTriggerMatchPort["send"]>[0][] = [];
  send(input: Parameters<TraceAlertTriggerMatchPort["send"]>[0]): Promise<void> {
    this.inputs.push(input);
    return Promise.resolve();
  }
}

class PassingOrigin extends TraceAlertOriginGuardPort {
  passes(): boolean {
    return true;
  }
}

class RecordingMetrics extends TraceAlertMetricsPort {
  readonly counts: number[] = [];
  countRecorded(count: number): void {
    this.counts.push(count);
  }
}

const event: GovernanceTraceEvent = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: createTenantId("project-1"),
  createdAt: 1_000,
  occurredAt: 1_000,
  type: "lw.obs.trace.span_received",
  version: "2026-01-01",
  data: {},
};

const context: GovernanceTraceContext = {
  tenantId: "project-1",
  aggregateId: "trace-1",
  state: {
    traceId: "trace-1",
    occurredAt: 1_700_000_000_000,
    totalCost: 0.0042,
    totalPromptTokenCount: 120,
    totalCompletionTokenCount: 42,
    models: ["model-1"],
    attributes: {
      "langwatch.origin.kind": "ingestion_source",
      "langwatch.ingestion_source.id": "source-1",
      "langwatch.ingestion_source.source_type": "otel_generic",
    },
  },
};

describe("governance fold subscribers", () => {
  it("declines non-governance traces before enqueue and in the handler", async () => {
    const rows = new RecordingKpis();
    const subscriber = GovernanceKpisSubscriber.create({
      contributions: rows,
      diagnostics: new RecordingDiagnostics(),
    });
    const nonGovernance = {
      ...context,
      state: { ...context.state, attributes: {} },
    };
    expect(subscriber.when(event, nonGovernance)).toBe(false);
    await subscriber.handle(event, nonGovernance);
    expect(rows.rows).toEqual([]);
  });

  it("derives a stable KPI replacement identity on redelivery", async () => {
    const rows = new RecordingKpis();
    const subscriber = GovernanceKpisSubscriber.create({
      contributions: rows,
      diagnostics: new RecordingDiagnostics(),
    });
    await subscriber.handle(event, context);
    await subscriber.handle(event, context);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toEqual(rows.rows[1]);
    expect(rows.rows[0]).toMatchObject({
      tenantId: "project-1",
      sourceId: "source-1",
      traceId: "trace-1",
    });
  });

  it("derives one stable OCSF event id and elevates anomaly severity", async () => {
    const rows = new RecordingOcsf();
    const subscriber = GovernanceOcsfSubscriber.create({
      events: rows,
      diagnostics: new RecordingDiagnostics(),
    });
    const alerted = {
      ...context,
      state: {
        ...context.state,
        attributes: {
          ...context.state.attributes,
          "langwatch.governance.anomaly_alert_id": "alert-1",
        },
      },
    };
    await subscriber.handle(event, alerted);
    await subscriber.handle(event, alerted);
    expect(rows.rows.map((row) => row.eventId)).toEqual(["trace-1", "trace-1"]);
    expect(rows.rows[0]?.severityId).toBe(4);
  });
});

describe("trace alert trigger match subscriber", () => {
  it("redelivers byte-identical command identities and skips evaluation triggers", async () => {
    const matches = new RecordingMatches();
    const metrics = new RecordingMetrics();
    const subscriber = TraceAlertTriggerMatchSubscriber.create({
      triggers: new FixedTriggers([
        {
          id: "trace-trigger",
          action: "send_email",
          actionClass: "notify",
          traceDebounceMs: 1_000,
          notificationCadence: "once",
          hasEvaluationFilters: false,
        },
        {
          id: "evaluation-trigger",
          action: "send_email",
          actionClass: "notify",
          traceDebounceMs: 1_000,
          notificationCadence: "once",
          hasEvaluationFilters: true,
        },
      ]),
      matches,
      originGuard: new PassingOrigin(),
      metrics,
    });
    await subscriber.handle(event, context);
    await subscriber.handle(event, context);
    expect(matches.inputs).toHaveLength(2);
    expect(matches.inputs[0]).toEqual(matches.inputs[1]);
    expect(matches.inputs[0]).toMatchObject({
      occurredAt: event.occurredAt,
      triggerId: "trace-trigger",
      traceId: "trace-1",
    });
    expect(metrics.counts).toEqual([1, 1]);
  });
});
