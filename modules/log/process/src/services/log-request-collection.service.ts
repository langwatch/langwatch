import type {
  CanonicalLogRecord,
  LogApi,
  LogPiiRedactionLevel,
  LogPreparation,
  LogRequestCollectionResult,
} from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  NON_BILLABLE_ATTR,
  type LogRecordReceivedEventData,
  type LogTraceContribution,
  type TraceApi,
} from "@langwatch/trace-contract";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

/** Trace's share of a log: its canonical names, its I/O preview and its contribution command. */
export type LogTraceSlice = Pick<
  TraceApi,
  "canonicalizeLogRecord" | "extractLogRecordIO" | "recordLogContributions"
>;

export interface LogRequestCollectionDeps {
  traces: LogTraceSlice;
  /** Only the preparation half of `LogApi`: this collector sends its own batch, itself. */
  logs: Pick<LogApi, "prepareCanonicalLogRecords">;
  recordLogRecords: (data: CanonicalLogRecord[]) => Promise<void>;
}

/** Returned in place of a persistence exception, which may name internals. */
const PERSISTENCE_ERROR_MESSAGE = "failed to record log record";

export class LogRequestCollectionService {
  private readonly tracer = getLangWatchTracer("langwatch.log-processing.log-ingestion");
  private readonly logger = createLogger("langwatch:log-processing:log-ingestion");
  private constructor(private readonly deps: LogRequestCollectionDeps) {}

  static create(deps: LogRequestCollectionDeps): LogRequestCollectionService {
    return new LogRequestCollectionService(deps);
  }

  async handleOtlpLogRequest({
    tenantId,
    organizationId,
    logRequest,
    piiRedactionLevel,
  }: {
    tenantId: string;
    organizationId: string;
    logRequest: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
  }): Promise<LogRequestCollectionResult> {
    return this.tracer.withActiveSpan(
      "LogRequestCollectionService.handleOtlpLogRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          "organization.id": organizationId,
          resource_log_count: countResourceLogs(logRequest),
        },
      },
      async (span): Promise<LogRequestCollectionResult> => {
        const preparation = await this.deps.logs.prepareCanonicalLogRecords({
          tenantId,
          organizationId,
          request: logRequest,
          piiRedactionLevel,
          acceptedAt: nowInstant().epochMilliseconds,
        });
        // Only preparation can reject: it is the sole stage that judges the
        // sender's payload. Everything after it either persists the record or
        // fails on our side, and neither may be reported as a rejection.
        const acceptedLogRecords = preparation.accepted.length;
        const rejectedLogRecords = preparation.rejectedLogRecords;
        const errors = preparation.errors;

        if (!(await this.persistAccepted({ tenantId, preparation }))) {
          span.setAttribute("logs.ingestion.unavailable", preparation.accepted.length);

          return { outcome: "unavailable", errorMessage: PERSISTENCE_ERROR_MESSAGE };
        }

        await this.persistContributions({
          tenantId,
          contributions: this.buildContributions({ tenantId, preparation }),
        });

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

  /**
   * Enqueues the canonical records, reporting whether they landed. Preparation errors describe
   * the caller's own payload and are safe to return; a persistence failure is ours, so its
   * message — which can name internal hosts, tables and queries — goes to the log only.
   */
  private async persistAccepted({
    tenantId,
    preparation,
  }: {
    tenantId: string;
    preparation: LogPreparation;
  }): Promise<boolean> {
    if (preparation.accepted.length === 0) {
      return true;
    }

    try {
      await this.deps.recordLogRecords(preparation.accepted.map(({ record }) => record));

      return true;
    } catch (error) {
      this.logger.error(
        {
          error,
          tenantId,
          recordCount: preparation.accepted.length,
          recordIds: preparation.accepted.slice(0, 10).map(({ record }) => record.recordId),
        },
        "Failed to enqueue canonical log record batch",
      );

      return false;
    }
  }

  /**
   * The trace contributions the accepted records correlate to. Best-effort: the canonical
   * record is already durably enqueued, so failing to derive its contribution must not tell
   * the sender to discard a log we hold. Log only — do not touch the counters.
   */
  private buildContributions({
    tenantId,
    preparation,
  }: {
    tenantId: string;
    preparation: LogPreparation;
  }): LogTraceContribution[] {
    const contributions: LogTraceContribution[] = [];
    for (const prepared of preparation.accepted) {
      const { record } = prepared;
      const correlationSource = record.correlationSource;
      if (correlationSource === "none" || !record.correlationTraceId || !record.correlationSpanId) {
        continue;
      }

      try {
        contributions.push(
          makeTraceContribution({ prepared, correlationSource, traces: this.deps.traces }),
        );
      } catch (error) {
        this.logger.error(
          { error, tenantId, recordId: record.recordId, traceId: record.correlationTraceId },
          "Failed to build log trace contribution",
        );
      }
    }

    return contributions;
  }

  /**
   * Correlation is best-effort: canonical records are already durably enqueued,
   * so contribution failures must not be reported as log rejections.
   */
  private async persistContributions({
    tenantId,
    contributions,
  }: {
    tenantId: string;
    contributions: LogTraceContribution[];
  }): Promise<void> {
    if (contributions.length === 0) {
      return;
    }

    try {
      await this.deps.traces.recordLogContributions(contributions);
    } catch (error) {
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
}

function makeTraceContribution({
  prepared,
  correlationSource,
  traces,
}: {
  prepared: LogPreparation["accepted"][number];
  correlationSource: LogTraceContribution["correlationSource"];
  traces: LogTraceSlice;
}): LogTraceContribution {
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
  const lifted = traces.canonicalizeLogRecord({
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

  const { input, output, truncated } = traces.extractLogRecordIO(legacyView);
  if (truncated) {
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
    correlationSource,
    input,
    output,
    liftedAttributes,
    nonBillable: normalized.resourceAttributes[NON_BILLABLE_ATTR] === "true",
    piiRedactionLevel: record.piiRedactionLevel,
    occurredAt: record.acceptedAt,
  };
}

function countResourceLogs(request: unknown): number {
  if (typeof request !== "object" || request === null || !("resourceLogs" in request)) return 0;
  return Array.isArray(request.resourceLogs) ? request.resourceLogs.length : 0;
}
