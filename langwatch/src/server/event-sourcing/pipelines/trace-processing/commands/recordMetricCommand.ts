import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import {
  recordMetricCommandDataSchema,
  type RecordMetricCommandData,
} from "../schemas/commands";
import {
  RECORD_METRIC_COMMAND_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { MetricRecordReceivedEvent } from "../schemas/events";

export class RecordMetricCommand
  implements
    CommandHandler<Command<RecordMetricCommandData>, MetricRecordReceivedEvent>
{
  static readonly schema = defineCommandSchema(
    RECORD_METRIC_COMMAND_TYPE,
    recordMetricCommandDataSchema,
    "Command to record a metric in the trace processing pipeline",
  );

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.record-metric",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:record-metric",
  );

  async handle(
    command: Command<RecordMetricCommandData>,
  ): Promise<MetricRecordReceivedEvent[]> {
    return await this.tracer.withActiveSpan(
      "RecordMetricCommand.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        const { tenantId: tenantIdStr, data: commandData } = command;
        const tenantId = createTenantId(tenantIdStr);

        this.logger.info(
          {
            tenantId,
            traceId: commandData.traceId,
            spanId: commandData.spanId,
            metricName: commandData.metricName,
          },
          "Handling record metric command",
        );

        const event = EventUtils.createEvent<MetricRecordReceivedEvent>({
          aggregateType: "trace",
          aggregateId: commandData.traceId,
          tenantId,
          type: METRIC_RECORD_RECEIVED_EVENT_TYPE,
          version: METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST,
          data: {
            traceId: commandData.traceId,
            spanId: commandData.spanId,
            metricName: commandData.metricName,
            metricUnit: commandData.metricUnit,
            metricType: commandData.metricType,
            value: commandData.value,
            timeUnixMs: commandData.timeUnixMs,
            attributes: commandData.attributes,
            resourceAttributes: commandData.resourceAttributes,
          },
          metadata: {},
          occurredAt: commandData.occurredAt,
          idempotencyKey: RecordMetricCommand.makeJobId(commandData),
        });

        return [event];
      },
    );
  }

  static getAggregateId(payload: RecordMetricCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: RecordMetricCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.span.id": payload.spanId,
      "payload.metric.name": payload.metricName,
    };
  }

  static makeJobId(payload: RecordMetricCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:${payload.spanId}:${payload.metricName}:${payload.timeUnixMs}:${payload.metricType}`;
  }
}
