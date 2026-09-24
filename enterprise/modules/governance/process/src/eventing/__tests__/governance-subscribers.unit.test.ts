import { describe, expect, it } from "vitest";

import type {
  GovernanceKpiContributionWriter,
  GovernanceOcsfEventWriter,
  GovernanceSubscriberDiagnosticsSink,
  GovernanceKpiContribution,
  GovernanceOcsfEvent,
} from "../../app/governance.members.ts";
import { GovernanceKpisSubscriber } from "../governance-kpis.subscriber.ts";
import { GovernanceOcsfSubscriber } from "../governance-ocsf.subscriber.ts";
import { governanceTraceContext, governanceTraceEvent } from "./governance-subscriber.fixtures.ts";

class RecordingKpis implements GovernanceKpiContributionWriter {
  readonly rows: GovernanceKpiContribution[] = [];
  insertContribution(row: GovernanceKpiContribution): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

class RecordingOcsf implements GovernanceOcsfEventWriter {
  readonly rows: GovernanceOcsfEvent[] = [];
  insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

class RecordingDiagnostics implements GovernanceSubscriberDiagnosticsSink {
  readonly warnings: string[] = [];
  readonly errors: unknown[] = [];
  warn(input: { code: string }): void {
    this.warnings.push(input.code);
  }
  capture(error: unknown): void {
    this.errors.push(error);
  }
}

// The same event and the same governed trace the three redelivery suites run
// on, so a change to either lands on all four rather than on three of them.
const event = governanceTraceEvent;
const context = governanceTraceContext;

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
