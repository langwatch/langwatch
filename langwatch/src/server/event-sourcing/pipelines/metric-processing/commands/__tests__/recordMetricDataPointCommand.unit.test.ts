import { describe, expect, it } from "vitest";
import type { Command } from "../../../../commands/command";
import { createTenantId } from "../../../../domain/tenantId";
import { RecordMetricDataPointCommand } from "../recordMetricDataPointCommand";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
} from "../../schemas/constants";
import type { RecordMetricDataPointCommandData } from "../../schemas/commands";

describe("RecordMetricDataPointCommand", () => {
  it("uses PointId for the aggregate and idempotency key", async () => {
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
      idempotencyKey: pointId,
      data,
    });
  });
});
