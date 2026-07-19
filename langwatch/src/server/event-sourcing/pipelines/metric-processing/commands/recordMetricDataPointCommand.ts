import type { Command, CommandHandler } from "../../../commands/command";
import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST,
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
} from "../schemas/constants";
import type { RecordMetricDataPointCommandData } from "../schemas/commands";
import { recordMetricDataPointCommandDataSchema } from "../schemas/commands";
import type { MetricDataPointReceivedEvent } from "../schemas/events";

export class RecordMetricDataPointCommand implements CommandHandler<
  Command<RecordMetricDataPointCommandData>,
  MetricDataPointReceivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
    recordMetricDataPointCommandDataSchema,
    "Record one lossless canonical OpenTelemetry metric data point",
  );

  async handle(
    command: Command<RecordMetricDataPointCommandData>,
  ): Promise<MetricDataPointReceivedEvent[]> {
    const data = command.data;
    const event = EventUtils.createEvent<MetricDataPointReceivedEvent>({
      aggregateType: "metric",
      aggregateId: data.pointId,
      tenantId: createTenantId(command.tenantId),
      type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
      version: METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST,
      data,
      metadata: {},
      occurredAt: data.occurredAt,
      idempotencyKey: data.pointId,
    });
    return [event];
  }

  static getAggregateId(payload: RecordMetricDataPointCommandData): string {
    return payload.pointId;
  }

  static getSpanAttributes(
    payload: RecordMetricDataPointCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.metric.point_id": payload.pointId,
      "payload.metric.series_id": payload.seriesId,
      "payload.metric.name": payload.metricName,
      "payload.metric.kind": payload.metricKind,
    };
  }
}
