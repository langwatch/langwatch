import type { Command, CommandHandler } from "../../../commands/command";
import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import {
  METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
  METRIC_DATA_POINT_CORRELATED_EVENT_VERSION_LATEST,
  RECORD_METRIC_CORRELATION_COMMAND_TYPE,
} from "../schemas/constants";
import {
  recordMetricCorrelationCommandDataSchema,
  type RecordMetricCorrelationCommandData,
} from "../schemas/commands";
import type { MetricDataPointCorrelatedEvent } from "../schemas/events";

export class RecordMetricCorrelationCommand implements CommandHandler<
  Command<RecordMetricCorrelationCommandData>,
  MetricDataPointCorrelatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_METRIC_CORRELATION_COMMAND_TYPE,
    recordMetricCorrelationCommandDataSchema,
    "Attach a valid metric exemplar correlation to a trace",
  );

  async handle(
    command: Command<RecordMetricCorrelationCommandData>,
  ): Promise<MetricDataPointCorrelatedEvent[]> {
    const data = command.data;
    if (
      !/^[a-f0-9]{32}$/i.test(data.traceId) ||
      /^0+$/.test(data.traceId) ||
      !/^[a-f0-9]{16}$/i.test(data.spanId) ||
      /^0+$/.test(data.spanId)
    ) {
      return [];
    }
    return [
      EventUtils.createEvent<MetricDataPointCorrelatedEvent>({
        aggregateType: "trace",
        aggregateId: data.traceId,
        tenantId: createTenantId(command.tenantId),
        type: METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
        version: METRIC_DATA_POINT_CORRELATED_EVENT_VERSION_LATEST,
        data: {
          traceId: data.traceId,
          spanId: data.spanId,
          pointId: data.pointId,
          seriesId: data.seriesId,
          metricName: data.metricName,
          metricUnit: data.metricUnit,
          metricKind: data.metricKind,
          exemplarValue: data.exemplarValue,
          exemplarTimeUnixMs: data.exemplarTimeUnixMs,
        },
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.pointId}:${data.traceId}:${data.spanId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordMetricCorrelationCommandData): string {
    return payload.traceId;
  }

  static makeJobId(payload: RecordMetricCorrelationCommandData): string {
    return `${payload.pointId}:${payload.traceId}:${payload.spanId}`;
  }
}
