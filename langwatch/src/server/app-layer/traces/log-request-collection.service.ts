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

/**
 * The outcome of an OTLP log request.
 *
 * The two cases are deliberately separate shapes rather than a counter pair.
 * An OTLP `partialSuccess` body means the server rejected those records
 * *permanently* and the client must not re-send them, so folding a failure
 * that is ours — a queue outage, say — into `rejectedLogRecords` tells every
 * collector in the fleet to drop data it would otherwise have retried. As a
 * counter pair the two are one indistinguishable `+= n`; as a discriminated
 * union, conflating them is a type error at the call site.
 */
export type LogRequestCollectionResult =
  | {
      outcome: "collected";
      acceptedLogRecords: number;
      /** Rejected for good — the caller must NOT retry these. */
      rejectedLogRecords: number;
      errorMessage?: string;
    }
  | {
      /**
       * Nothing was durably accepted. `recordLogRecords` enqueues the batch in
       * one call, so this is all-or-nothing: the caller must retry the whole
       * request, and the route must answer with a retryable status.
       */
      outcome: "unavailable";
      errorMessage: string;
    };

/** Returned in place of a persistence exception, which may name internals. */
const PERSISTENCE_ERROR_MESSAGE = "failed to record log record";

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
      async (span): Promise<LogRequestCollectionResult> => {
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
            // Preparation errors describe the caller's own payload and are
            // safe to return. A persistence failure is ours: its message can
            // name internal hosts, tables and queries, so the sender gets a
            // stable string and the detail goes to the log only.
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
            span.setAttribute(
              "logs.ingestion.unavailable",
              preparation.accepted.length,
            );
            return {
              outcome: "unavailable",
              errorMessage: PERSISTENCE_ERROR_MESSAGE,
            };
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
            // Correlation is deliberately best-effort and separate from log
            // acceptance, matching the metric pipeline: the canonical record
            // is already durably enqueued above, and it — not the trace
            // contribution — is the source of truth. Counting these as
            // rejections would tell the sender to discard logs we have in
            // fact accepted.
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
          outcome: "collected",
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
