import { createLogger } from "@langwatch/observability";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import type { DeepPartial } from "~/utils/types";
import {
  type LogRedactionService,
  prepareCanonicalLogRecords,
} from "../../event-sourcing/pipelines/log-processing/canonicalLog";
import type {
  CanonicalLogRecord,
  LogTraceContribution,
} from "../../event-sourcing/pipelines/log-processing/schemas/logRecord";
import {
  extractIOFromLogRecord,
  liftCanonicalAttributesFromLogRecord,
  NON_BILLABLE_ATTR,
} from "../../event-sourcing/pipelines/trace-processing/projections/services";
import { piiRedactionLevelSchema } from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { LogRecordReceivedEventData } from "../../event-sourcing/pipelines/trace-processing/schemas/events";
import { IO_PREVIEW_BYTES, utf8Preview } from "./lean-for-projection";
import { OtlpSpanPiiRedactionService } from "./span-pii-redaction.service";

export interface LogRequestCollectionDeps {
  recordLogRecords: (data: CanonicalLogRecord[]) => Promise<void>;
  recordLogContributions: (data: LogTraceContribution[]) => Promise<void>;
  piiRedactionService?: LogRedactionService;
}

export interface LogRequestCollectionResult {
  acceptedLogRecords: number;
  rejectedLogRecords: number;
  errorMessage?: string;
}

export class LogRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.log-processing.log-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:log-processing:log-ingestion",
  );
  private readonly piiRedactionService: LogRedactionService;

  constructor(private readonly deps: LogRequestCollectionDeps) {
    this.piiRedactionService =
      deps.piiRedactionService ?? new OtlpSpanPiiRedactionService();
  }

  async handleOtlpLogRequest({
    tenantId,
    organizationId,
    logRequest,
    piiRedactionLevel,
  }: {
    tenantId: string;
    organizationId: string;
    logRequest: DeepPartial<IExportLogsServiceRequest>;
    piiRedactionLevel: string;
  }): Promise<LogRequestCollectionResult> {
    return await this.tracer.withActiveSpan(
      "LogRequestCollectionService.handleOtlpLogRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          "organization.id": organizationId,
          resource_log_count: logRequest.resourceLogs?.length ?? 0,
        },
      },
      async (span) => {
        const preparation = await prepareCanonicalLogRecords({
          tenantId,
          organizationId,
          request: logRequest,
          piiRedactionLevel: piiRedactionLevelSchema.parse(piiRedactionLevel),
          redactionService: this.piiRedactionService,
          acceptedAt: Date.now(),
        });
        let acceptedLogRecords = preparation.accepted.length;
        let rejectedLogRecords = preparation.rejectedLogRecords;
        const errors = [...preparation.errors];

        if (preparation.accepted.length > 0) {
          try {
            await this.deps.recordLogRecords(
              preparation.accepted.map(({ record }) => record),
            );
          } catch (error) {
            acceptedLogRecords = 0;
            rejectedLogRecords += preparation.accepted.length;
            const message =
              error instanceof Error ? error.message : String(error);
            errors.push(`canonical log batch: ${message}`);
            this.logger.error(
              {
                error,
                tenantId,
                recordCount: preparation.accepted.length,
                recordIds: preparation.accepted
                  .slice(0, 10)
                  .map(({ record }) => record.recordId),
              },
              "Failed to enqueue canonical log record batch",
            );
          }
        }

        const contributions: LogTraceContribution[] = [];
        if (acceptedLogRecords > 0) {
          for (const prepared of preparation.accepted) {
            const { record } = prepared;
            if (
              record.correlationSource === "none" ||
              !record.correlationTraceId ||
              !record.correlationSpanId
            ) {
              continue;
            }
            try {
              contributions.push(makeTraceContribution(prepared));
            } catch (error) {
              acceptedLogRecords--;
              rejectedLogRecords++;
              const message =
                error instanceof Error ? error.message : String(error);
              errors.push(`${record.recordId}: ${message}`);
              this.logger.error(
                {
                  error,
                  tenantId,
                  recordId: record.recordId,
                  traceId: record.correlationTraceId,
                },
                "Failed to build log trace contribution",
              );
            }
          }
        }

        if (contributions.length > 0) {
          try {
            await this.deps.recordLogContributions(contributions);
          } catch (error) {
            acceptedLogRecords -= contributions.length;
            rejectedLogRecords += contributions.length;
            const message =
              error instanceof Error ? error.message : String(error);
            errors.push(`log trace contribution batch: ${message}`);
            this.logger.error(
              {
                error,
                tenantId,
                contributionCount: contributions.length,
                recordIds: contributions
                  .slice(0, 10)
                  .map(({ recordId }) => recordId),
              },
              "Failed to enqueue log trace contribution batch",
            );
          }
        }

        span.setAttribute("logs.ingestion.successes", acceptedLogRecords);
        span.setAttribute("logs.ingestion.failures", rejectedLogRecords);
        const errorMessage = errors.length
          ? errors.join("; ").slice(0, 1024)
          : undefined;
        return {
          acceptedLogRecords,
          rejectedLogRecords,
          ...(errorMessage ? { errorMessage } : {}),
        };
      },
    );
  }
}

function makeTraceContribution(
  prepared: Awaited<
    ReturnType<typeof prepareCanonicalLogRecords>
  >["accepted"][number],
): LogTraceContribution {
  const { record, normalized } = prepared;
  const legacyView: LogRecordReceivedEventData = {
    traceId: record.correlationTraceId,
    spanId: record.correlationSpanId,
    timeUnixMs: record.timeUnixMs,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body: normalized.body,
    attributes: normalized.attributes,
    resourceAttributes: normalized.resourceAttributes,
    scopeName: normalized.scopeName,
    scopeVersion: normalized.scopeVersion,
    piiRedactionLevel: record.piiRedactionLevel,
  };
  const lifted = liftCanonicalAttributesFromLogRecord(legacyView);
  const liftedAttributes: LogTraceContribution["liftedAttributes"] = {};
  for (const [key, value] of Object.entries(lifted)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      liftedAttributes[key] = value;
    }
  }
  const io = extractIOFromLogRecord(legacyView);
  const input =
    io.input === null ? null : utf8Preview(io.input, IO_PREVIEW_BYTES);
  const output =
    io.output === null ? null : utf8Preview(io.output, IO_PREVIEW_BYTES);
  if (input !== io.input || output !== io.output) {
    liftedAttributes["langwatch.reserved.log_io_truncated"] = true;
  }
  return {
    tenantId: record.tenantId,
    recordId: record.recordId,
    traceId: record.correlationTraceId,
    spanId: record.correlationSpanId,
    timeUnixMs: record.timeUnixMs,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    providerKind: record.providerKind,
    scopeName: record.scopeName,
    correlationSource: record.correlationSource as Exclude<
      typeof record.correlationSource,
      "none"
    >,
    input,
    output,
    liftedAttributes,
    nonBillable: normalized.resourceAttributes[NON_BILLABLE_ATTR] === "true",
    piiRedactionLevel: record.piiRedactionLevel,
    occurredAt: record.acceptedAt,
  };
}
