import crypto from "node:crypto";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type PIIRedactionLevel,
  recordMetricCommandDataSchema,
  type RecordMetricCommandData,
} from "../schemas/commands";
import {
  RECORD_METRIC_COMMAND_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { MetricRecordReceivedEvent } from "../schemas/events";

/**
 * Dependencies for RecordMetricCommand that can be injected for testing.
 */
export interface RecordMetricCommandDependencies {
  /** Service for redacting PII from metric attributes. */
  piiRedactionService: {
    redactMetricAttributes: (
      metric: {
        attributes: Record<string, string>;
        resourceAttributes: Record<string, string>;
      },
      piiRedactionLevel: PIIRedactionLevel,
    ) => Promise<void>;
  };
}

function createDefaultDependencies(): RecordMetricCommandDependencies {
  return {
    piiRedactionService: new OtlpSpanPiiRedactionService(),
  };
}

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
  private readonly deps: RecordMetricCommandDependencies;

  constructor(deps?: RecordMetricCommandDependencies) {
    this.deps = deps ?? createDefaultDependencies();
  }

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

        this.logger.debug(
          {
            tenantId,
            traceId: commandData.traceId,
            spanId: commandData.spanId,
            metricName: commandData.metricName,
          },
          "Handling record metric command",
        );

        const piiRedactionLevel =
          commandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;

        // Clone attributes before mutation
        const metricToRedact = {
          attributes: { ...commandData.attributes },
          resourceAttributes: { ...commandData.resourceAttributes },
        };

        try {
          await this.deps.piiRedactionService.redactMetricAttributes(
            metricToRedact,
            piiRedactionLevel,
          );
        } catch (error) {
          this.logger.error(
            { error, tenantId, traceId: commandData.traceId },
            "PII redaction failed for metric, aborting to prevent leak",
          );
          throw error;
        }

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
            attributes: metricToRedact.attributes,
            resourceAttributes: metricToRedact.resourceAttributes,
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
    const attributesHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(Object.entries(payload.attributes).sort()))
      .update(
        JSON.stringify(Object.entries(payload.resourceAttributes).sort()),
      )
      .digest("hex")
      .slice(0, 8);
    return `${payload.tenantId}:${payload.traceId}:${payload.spanId}:${payload.metricName}:${payload.timeUnixMs}:${payload.metricType}:${payload.value}:${attributesHash}`;
  }
}
