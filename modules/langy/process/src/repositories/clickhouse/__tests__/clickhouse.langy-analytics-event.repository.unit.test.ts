import { describe, expect, it, vi } from "vitest";

import type { LangyAnalyticsEventRecord } from "../../langy-analytics-event.repository.ts";
import {
  type LangyAnalyticsClickHouseMember,
  LangyAnalyticsEventClickHouseRepository,
} from "../clickhouse.langy-analytics-event.repository.ts";

const record: LangyAnalyticsEventRecord = {
  tenantId: "project_1",
  eventId: "event_1",
  eventType: "lw.langy_conversation.conversation_started",
  eventVersion: "2026-07-12",
  aggregateId: "conversation_1",
  turnId: "turn_1",
  userId: "user_1",
  role: "user",
  toolName: null,
  outcome: null,
  model: "openai/gpt-5-mini",
  durationMs: 1_234.6,
  occurredAtMs: 1_000,
  acceptedAtMs: 1_100,
};

/** The columns migration 00047 declares for langy_analytics_events, as the sink writes them. */
const WRITTEN_COLUMNS = [
  "AcceptedAt",
  "AggregateId",
  "DurationMs",
  "EventId",
  "EventType",
  "EventVersion",
  "Model",
  "OccurredAt",
  "Outcome",
  "Role",
  "TenantId",
  "ToolName",
  "TurnId",
  "UserId",
  "_retention_days",
];

describe("LangyAnalyticsEventClickHouseRepository over the process's own ClickHouse", () => {
  describe("when the analytics projection appends a row", () => {
    /** @scenario "Langy analytics rows land on this process's own ClickHouse" */
    it("writes the langy analytics table under the declared column names, stamped with the deployment's retention", async () => {
      const insert = vi.fn<LangyAnalyticsClickHouseMember["insert"]>(async () => undefined);
      const repository = LangyAnalyticsEventClickHouseRepository.overMember({ insert });

      await repository.insert(record, 45);

      expect(insert).toHaveBeenCalledOnce();
      const request = insert.mock.calls[0]![0];
      expect(request.tenantId).toBe("project_1");
      expect(request.table).toBe("langy_analytics_events");
      expect(request.rows).toHaveLength(1);
      const row = request.rows[0]!;
      expect(Object.keys(row).toSorted()).toEqual(WRITTEN_COLUMNS.toSorted());
      expect(row).toMatchObject({
        TenantId: "project_1",
        EventId: "event_1",
        AggregateId: "conversation_1",
        DurationMs: "1235",
        _retention_days: 45,
      });
    });
  });
});
