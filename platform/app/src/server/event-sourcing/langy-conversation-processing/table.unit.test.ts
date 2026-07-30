import { describe, expect, it } from "vitest";
import type { LangyAnalyticsEventRecord } from "./maps";
import {
  LANGY_ANALYTICS_RETENTION_DAYS,
  langyAnalyticsEventRow,
  langyAnalyticsEventsTable,
} from "./table";

const record: LangyAnalyticsEventRecord = {
  eventId: "event-1",
  eventType: "lw.langy_conversation.tool_call_succeeded",
  eventVersion: "2026-07-10",
  aggregateId: "conv-1",
  turnId: "turn-1",
  userId: null,
  role: null,
  toolName: "bash",
  outcome: null,
  model: null,
  durationMs: 42,
  occurredAt: 1_000,
  acceptedAt: 2_000,
};

/** Migration parity — engine, keys, anchors, column types — is asserted against
 *  the migration SQL in `../__tests__/tableMigrationParity.unit.test.ts`. */
describe("langy_analytics_events", () => {
  it("names the debt its anchor carries, and still carries our own stamp on the row", () => {
    const anchor = langyAnalyticsEventsTable.partition.column;
    expect(langyAnalyticsEventsTable.columns[anchor]?.timeRole).toBe(
      "occurredAt",
    );
    expect(
      langyAnalyticsEventsTable.structuralDebt?.map((debt) => debt.column),
    ).toEqual([anchor]);
    expect(langyAnalyticsEventsTable.columns.AcceptedAt.timeRole).toBe(
      "acceptedAt",
    );
  });

  it("maps a record onto the row, coercing times and the 64-bit measure", () => {
    const row = langyAnalyticsEventRow(record, { tenantId: "project-1" });

    expect(row).toEqual({
      TenantId: "project-1",
      EventId: "event-1",
      EventType: "lw.langy_conversation.tool_call_succeeded",
      EventVersion: "2026-07-10",
      AggregateId: "conv-1",
      TurnId: "turn-1",
      UserId: null,
      Role: null,
      ToolName: "bash",
      Outcome: null,
      Model: null,
      DurationMs: 42n,
      OccurredAt: new Date(1_000),
      AcceptedAt: new Date(2_000),
      ProjectedAt: expect.any(Date),
      _retention_days: LANGY_ANALYTICS_RETENTION_DAYS,
    });
  });

  it("takes retention from the delivery when the policy resolved one", () => {
    const row = langyAnalyticsEventRow(record, {
      tenantId: "project-1",
      retentionDays: 30,
    });

    expect(row._retention_days).toBe(30);
  });
});
