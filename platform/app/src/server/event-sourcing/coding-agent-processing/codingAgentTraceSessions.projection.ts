import { deriveAppendMapping } from "@langwatch/clickhouse";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  type CodingAgentTraceSession,
  codingAgentTraceSessionSchema,
  type LogFactsContribution,
  type SpanFactsContribution,
} from "./schema";
import { codingAgentTraceSessionsTable } from "./table";

export function mapSpanTraceSession(
  data: SpanFactsContribution,
): CodingAgentTraceSession {
  return {
    tenantId: data.tenantId,
    traceId: data.traceId,
    sessionId: data.sessionId,
    occurredAt: data.occurredAt,
  };
}

/** A log record only maps a trace once correlation resolved one. */
export function mapLogTraceSession(
  data: LogFactsContribution,
): CodingAgentTraceSession | null {
  if (data.traceId === null) return null;
  return {
    tenantId: data.tenantId,
    traceId: data.traceId,
    sessionId: data.sessionId,
    occurredAt: data.occurredAt,
  };
}

export const toTraceSessionRow = deriveAppendMapping<
  CodingAgentTraceSession,
  typeof codingAgentTraceSessionsTable.columns
>({
  table: codingAgentTraceSessionsTable,
  record: codingAgentTraceSessionSchema,
  fill: {
    UpdatedAt: () => new Date(),
    _retention_days: (_record, context) =>
      context.retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
  },
});
