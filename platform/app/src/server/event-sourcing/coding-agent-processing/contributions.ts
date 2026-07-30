import {
  append,
  ch,
  createAppendStore,
  defineTable,
  type ClickHouseClient,
} from "@langwatch/clickhouse";
import type { AggregateEvent, AppendStore } from "@langwatch/event-sourcing";
import {
  contributionKindSchema,
  type CodingAgentSessionContributionRecord,
  type ContributionKind,
} from "./schema";

/**
 * One row per contribution: the item-grain table a session's totals are
 * derived from at read time, never incremented onto a fold row (ADR-103).
 * A redelivery re-derives the identical `(TenantId, SessionId, Kind,
 * SourceId)` key, so the ReplacingMergeTree collapses it at merge.
 */

export const codingAgentSessionContributionsTable = defineTable({
  name: "coding_agent_session_contributions",
  merge: append(),
  sortKey: ["TenantId", "SessionId", "Kind", "SourceId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    SessionId: ch.string(),
    Kind: ch.lowCardinality(ch.string()),
    SourceId: ch.string(),
    Agent: ch.lowCardinality(ch.string()),
    TraceId: ch.nullable(ch.string()),
    SpanId: ch.nullable(ch.string()),
    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    PayloadJson: ch.string(),
  },
});

export type CodingAgentSessionContributionsRow = ReturnType<
  typeof codingAgentSessionContributionsTable.rowSchema.parse
>;

const CONTRIBUTED_EVENT_TYPES: Readonly<Record<string, ContributionKind>> = {
  "coding_agent_session/spanFactsContributed": "span",
  "coding_agent_session/logFactsContributed": "log",
  "coding_agent_session/metricFactsContributed": "metric",
};

/** The source signal's own natural key — `spanId`/`recordId`/`seriesId`. */
function sourceIdOf(kind: ContributionKind, data: Record<string, unknown>): string {
  switch (kind) {
    case "span":
      return String(data.spanId);
    case "log":
      return String(data.recordId);
    case "metric":
      return String(data.seriesId);
  }
}

/** One contribution event -> one `coding_agent_session_contributions` row. */
export function mapToSessionContribution(
  event: AggregateEvent,
): CodingAgentSessionContributionRecord | null {
  const kind = CONTRIBUTED_EVENT_TYPES[event.type];
  if (kind === undefined) return null;
  contributionKindSchema.parse(kind);

  const data = event.data as Record<string, unknown>;
  return {
    tenantId: String(data.tenantId),
    sessionId: String(data.sessionId),
    kind,
    sourceId: sourceIdOf(kind, data),
    agent: String(data.agent),
    traceId: typeof data.traceId === "string" ? data.traceId : null,
    spanId: typeof data.spanId === "string" ? data.spanId : null,
    occurredAt: Number(data.occurredAt),
    acceptedAt: Number(data.acceptedAt),
    payloadJson: JSON.stringify(data),
  };
}

function toRow(
  record: CodingAgentSessionContributionRecord,
): CodingAgentSessionContributionsRow {
  return {
    TenantId: record.tenantId,
    SessionId: record.sessionId,
    Kind: record.kind,
    SourceId: record.sourceId,
    Agent: record.agent,
    TraceId: record.traceId,
    SpanId: record.spanId,
    PayloadJson: record.payloadJson,
    OccurredAt: new Date(record.occurredAt),
    AcceptedAt: new Date(record.acceptedAt),
  };
}

export function createCodingAgentSessionContributionsStore(args: {
  readonly client: ClickHouseClient;
}): AppendStore<CodingAgentSessionContributionRecord> {
  return createAppendStore({
    client: args.client,
    table: codingAgentSessionContributionsTable,
    toRow,
  });
}
