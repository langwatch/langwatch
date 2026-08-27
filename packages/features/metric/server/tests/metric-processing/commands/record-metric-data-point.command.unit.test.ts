import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import type { RecordMetricDataPointCommandData } from "@langwatch/metric-contract";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
} from "@langwatch/metric-contract";
import { RecordMetricDataPointCommand } from "../../../src/adapters/metric-processing.adapter";

describe("RecordMetricDataPointCommand", () => {
  it("uses PointId for the aggregate and a tenant-prefixed idempotency key", async () => {
    const pointId = "a".repeat(64);
    const data = {
      tenantId: "project-1",
      pointId,
      occurredAt: 1_700_000_000_000,
      acceptedAt: 1_800_000_000_000,
    } as RecordMetricDataPointCommandData;
    const command: Command<RecordMetricDataPointCommandData> = {
      tenantId: createTenantId("project-1"),
      aggregateId: pointId,
      type: RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
      data,
    };

    const events = await new RecordMetricDataPointCommand().handle(command);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregateType: "metric",
      aggregateId: pointId,
      tenantId: "project-1",
      type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
      occurredAt: 1_700_000_000_000,
      idempotencyKey: `project-1:${pointId}`,
      data,
    });
  });
});
