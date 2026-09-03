import { createLogger } from "@langwatch/observability";
import type { CanonicalLogRecord, LogPreparation, LogService } from "@langwatch/log-contract";
import {
  NON_BILLABLE_ATTR,
  type LogTraceContribution,
  type TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { TraceLogRecordIOService } from "@langwatch/trace-server";
import { piiRedactionLevelSchema } from "@langwatch/trace-contract";
import type { LogRecordReceivedEventData } from "@langwatch/trace-contract";
import { IO_PREVIEW_BYTES, utf8Preview } from "@langwatch/trace-server";

/**
 * Every field optional, all the way down.
 *
 * Stated here rather than imported: an OTLP export request arrives as JSON a
 * client assembled, so the transformer's own interface — which requires every
 * field — describes what a conforming exporter sends rather than what actually
 * lands. Was `platform/app/src/utils/types.ts`, a tree this migration only
 * deletes from.
 */
type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export interface LogRequestCollectionDeps {
  traceCanonicalisation: TraceCanonicalisationService;
  logs: LogService;
  recordLogRecords: (data: CanonicalLogRecord[]) => Promise<void>;
  recordLogContributions: (data: LogTraceContribution[]) => Promise<void>;
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
  private readonly tracer = getLangWatchTracer("langwatch.log-processing.log-ingestion");
  private readonly logger = createLogger("langwatch:log-processing:log-ingestion");
  constructor(private readonly deps: LogRequestCollectionDeps) {}

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
        const preparation = await this.deps.logs.prepareCanonicalLogRecords({
          tenantId,
          organizationId,
          request: logRequest,
          piiRedactionLevel: piiRedactionLevelSchema.parse(piiRedactionLevel),
          acceptedAt: Date.now(),
        });
        // Only preparation can reject: it is the sole stage that judges the
        // sender's payload. Everything after it either persists the record or
        // fails on our side, and neither may be reported as a rejection.
        const acceptedLogRecords = preparation.accepted.length;
        const rejectedLogRecords = preparation.rejectedLogRecords;
        const errors = preparation.errors;

        if (preparation.accepted.length > 0) {
          try {
            await this.deps.recordLogRecords(preparation.accepted.map(({ record }) => record));
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
                recordIds: preparation.accepted.slice(0, 10).map(({ record }) => record.recordId),
              },
              "Failed to enqueue canonical log record batch",
            );
            span.setAttribute("logs.ingestion.unavailable", preparation.accepted.length);
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
              contributions.push(makeTraceContribution(prepared, this.deps.traceCanonicalisation));
            } catch (error) {
              // Best-effort, for the same reason the enqueue failure below is:
              // the canonical record is already durably enqueued, so failing to
              // derive its trace contribution must not tell the sender to
              // discard a log we hold. Log only — do not touch the counters.
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
                recordIds: contributions.slice(0, 10).map(({ recordId }) => recordId),
              },
              "Failed to enqueue log trace contribution batch",
            );
          }
        }

        span.setAttribute("logs.ingestion.successes", acceptedLogRecords);
        span.setAttribute("logs.ingestion.failures", rejectedLogRecords);
        const errorMessage = errors.length ? errors.join("; ").slice(0, 1024) : undefined;
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
  prepared: LogPreparation["accepted"][number],
  traceCanonicalisation: TraceCanonicalisationService,
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
  const lifted = traceCanonicalisation.canonicalizeLogRecord({
    scopeName: legacyView.scopeName,
    body: legacyView.body,
    attributes: legacyView.attributes,
  }).attributes;
  const liftedAttributes: LogTraceContribution["liftedAttributes"] = {};
  for (const [key, value] of Object.entries(lifted)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      liftedAttributes[key] = value;
    }
  }
  const io = TraceLogRecordIOService.create(traceCanonicalisation).extractIO(legacyView);
  const input = io.input === null ? null : utf8Preview(io.input, IO_PREVIEW_BYTES);
  const output = io.output === null ? null : utf8Preview(io.output, IO_PREVIEW_BYTES);
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
    correlationSource: record.correlationSource as Exclude<typeof record.correlationSource, "none">,
    input,
    output,
    liftedAttributes,
    nonBillable: normalized.resourceAttributes[NON_BILLABLE_ATTR] === "true",
    piiRedactionLevel: record.piiRedactionLevel,
    occurredAt: record.acceptedAt,
  };
}
