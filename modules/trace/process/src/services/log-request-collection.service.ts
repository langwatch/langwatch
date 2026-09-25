import type { LogApi, LogPreparation } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  NON_BILLABLE_ATTR,
  type LogRecordReceivedEventData,
  type LogTraceContribution,
  type TraceCanonicalisationService,
  piiRedactionLevelSchema,
} from "@langwatch/trace-contract";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import {
  IO_PREVIEW_BYTES,
  TraceProjectionLeanService,
} from "./projection/trace-projection-lean.service.ts";
import type { TraceLogRecordIOService } from "./trace-log-record-io.service.ts";

export interface LogRequestCollectionDeps {
  logs: Pick<LogApi, "prepareCanonicalLogRecords" | "recordCanonicalLogRecords">;
  traceCanonicalisation: TraceCanonicalisationService;
  logRecordIO: Pick<TraceLogRecordIOService, "extractIO">;
  recordLogContributions: (data: LogTraceContribution[]) => Promise<void>;
}

/** `unavailable` means nothing was durably accepted: the sender retries the whole request. */
export type LogRequestCollectionResult =
  | {
      outcome: "collected";
      acceptedLogRecords: number;
      rejectedLogRecords: number;
      errorMessage?: string;
    }
  | { outcome: "unavailable"; errorMessage: string };

/** Returned in place of a persistence exception, which may name internals. */
const PERSISTENCE_ERROR_MESSAGE = "failed to record log record";

type PreparedLogRecord = LogPreparation["accepted"][number];

/** The OTLP log door's collection: Log prepares and records, Trace takes the contribution. */
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
    piiRedactionLevel: string;
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
          piiRedactionLevel: piiRedactionLevelSchema.parse(piiRedactionLevel),
          acceptedAt: nowInstant().epochMilliseconds,
        });
        const acceptedLogRecords = preparation.accepted.length;
        const rejectedLogRecords = preparation.rejectedLogRecords;

        if (!(await this.persistAccepted({ tenantId, preparation }))) {
          span.setAttribute("logs.ingestion.unavailable", acceptedLogRecords);
          return { outcome: "unavailable", errorMessage: PERSISTENCE_ERROR_MESSAGE };
        }

        await this.persistContributions({ tenantId, preparation });

        span.setAttribute("logs.ingestion.successes", acceptedLogRecords);
        span.setAttribute("logs.ingestion.failures", rejectedLogRecords);
        const errors = preparation.errors;
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

  /** A persistence failure is ours: its message can name internals, so it goes to the log only. */
  private async persistAccepted({
    tenantId,
    preparation,
  }: {
    tenantId: string;
    preparation: LogPreparation;
  }): Promise<boolean> {
    if (preparation.accepted.length === 0) return true;

    try {
      await this.deps.logs.recordCanonicalLogRecords(
        preparation.accepted.map(({ record }) => record),
      );
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

  /** Best-effort: the canonical record is already enqueued, so a failure here rejects nothing. */
  private async persistContributions({
    tenantId,
    preparation,
  }: {
    tenantId: string;
    preparation: LogPreparation;
  }): Promise<void> {
    const contributions = preparation.accepted.flatMap((prepared) =>
      this.contributionFor({ tenantId, prepared }),
    );
    if (contributions.length === 0) return;

    try {
      await this.deps.recordLogContributions(contributions);
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

  /** The contribution one correlated record makes, or none; a failure to derive one is logged. */
  private contributionFor({
    tenantId,
    prepared,
  }: {
    tenantId: string;
    prepared: PreparedLogRecord;
  }): LogTraceContribution[] {
    const { record } = prepared;
    if (
      record.correlationSource === "none" ||
      !record.correlationTraceId ||
      !record.correlationSpanId
    ) {
      return [];
    }

    try {
      return [this.buildContribution({ prepared, correlationSource: record.correlationSource })];
    } catch (error) {
      this.logger.error(
        { error, tenantId, recordId: record.recordId, traceId: record.correlationTraceId },
        "Failed to build log trace contribution",
      );
      return [];
    }
  }

  private buildContribution({
    prepared,
    correlationSource,
  }: {
    prepared: PreparedLogRecord;
    correlationSource: LogTraceContribution["correlationSource"];
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
    const lifted = this.deps.traceCanonicalisation.canonicalizeLogRecord({
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

    const io = this.deps.logRecordIO.extractIO(legacyView);
    const input = io.input === null ? null : previewIo(io.input);
    const output = io.output === null ? null : previewIo(io.output);
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
      correlationSource,
      input,
      output,
      liftedAttributes,
      nonBillable: normalized.resourceAttributes[NON_BILLABLE_ATTR] === "true",
      piiRedactionLevel: record.piiRedactionLevel,
      occurredAt: record.acceptedAt,
    };
  }
}

function previewIo(value: string): string {
  return TraceProjectionLeanService.utf8Preview(value, IO_PREVIEW_BYTES);
}

function countResourceLogs(request: unknown): number {
  if (typeof request !== "object" || request === null || !("resourceLogs" in request)) return 0;
  return Array.isArray(request.resourceLogs) ? request.resourceLogs.length : 0;
}
