/**
 * The typed columns the stock dashboard widgets read, computed by the trace module's projections
 * from the same maps the rows carry, so no widget reads a map (analytics ADR-006).
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */
import { createHash } from "node:crypto";

import type { NormalizedSpan, SpanAnalyticsFloor } from "@langwatch/trace-contract";
import type { LedgerStepRecord } from "@langwatch/upgrade/reader";
import { projectionReplaySinceOf } from "@langwatch/upgrade/step";

/**
 * The replay step that refolds trace_analytics rows: the fold writes the 3 plain metadata
 * columns; the database computes the 9 MATERIALIZED ones.
 */
export const TRACE_ANALYTICS_REPLAY_STEP_ID = "trace:replay-trace-analytics-widget-columns";

/** The replay step that fills span_analytics; its recorded since is the span widgets' floor. */
export const SPAN_ANALYTICS_REPLAY_STEP_ID = "trace:replay-span-analytics";

/** How far back the replays reach: the stock widgets' longest period (60 days), plus two. */
export const WIDGET_COLUMNS_REPLAY_HOURS = 62 * 24;

/** `trace_analytics` metadata column → the `metadata.*` keys it reads, first non-empty wins. */
const TRACE_ANALYTICS_METADATA_KEYS = {
  // goose 00126: MATERIALIZED from the same key until the contract step (ADR-006).
  MetadataOutputAction: ["metadata.output_action"],
  MetadataOutcome: ["metadata.outcome"],
  MetadataSentToReview: ["metadata.sent_to_review"],
  MetadataDocumentType: ["metadata.document_type"],
  MetadataFlow: ["metadata.flow"],
  MetadataLanguage: ["metadata.language"],
  MetadataSegment: ["metadata.segment"],
  MetadataTeam: ["metadata.team"],
  MetadataTopic: ["metadata.topic"],
  // goose 00128: plain columns only the fold writes.
  MetadataOutcomeReason: ["metadata.outcome_reason"],
  MetadataPromptVersion: ["metadata.prompt_version"],
  MetadataEnvironment: ["metadata.environment", "metadata.env"],
} as const satisfies Record<string, readonly string[]>;

/** The `trace_analytics` metadata columns, by column name. */
export type TraceAnalyticsMetadataColumns = Record<
  keyof typeof TRACE_ANALYTICS_METADATA_KEYS,
  string
>;

/** Every metadata column name, in the order the fold writes them. */
const TRACE_ANALYTICS_METADATA_COLUMN_NAMES = Object.keys(
  TRACE_ANALYTICS_METADATA_KEYS,
) as (keyof TraceAnalyticsMetadataColumns)[];

/**
 * The 9 columns goose 00126 made MATERIALIZED, left to the database (same value from Attributes):
 * in prod the fold's insert of them failed with ILLEGAL_COLUMN despite the allow setting.
 * The ADR-006 REMOVE MATERIALIZED step waits until the fold writes them again.
 */
const MATERIALIZED_NAMES = [
  "MetadataOutputAction",
  "MetadataOutcome",
  "MetadataSentToReview",
  "MetadataDocumentType",
  "MetadataFlow",
  "MetadataLanguage",
  "MetadataSegment",
  "MetadataTeam",
  "MetadataTopic",
] as const satisfies readonly (keyof TraceAnalyticsMetadataColumns)[];

export const TRACE_ANALYTICS_MATERIALIZED_METADATA_COLUMNS: ReadonlySet<string> = new Set(
  MATERIALIZED_NAMES,
);

/** The plain metadata columns: what the fold inserts. */
export type TraceAnalyticsWrittenMetadataColumns = Omit<
  TraceAnalyticsMetadataColumns,
  (typeof MATERIALIZED_NAMES)[number]
>;

/** The metadata columns the fold inserts: the plain ones, never the MATERIALIZED nine. */
export function traceAnalyticsWrittenMetadataColumns(
  columns: TraceAnalyticsMetadataColumns,
): TraceAnalyticsWrittenMetadataColumns {
  return {
    MetadataOutcomeReason: columns.MetadataOutcomeReason,
    MetadataPromptVersion: columns.MetadataPromptVersion,
    MetadataEnvironment: columns.MetadataEnvironment,
  };
}

/**
 * The metadata columns of one `trace_analytics` row, read from the trimmed attribute map the row
 * stores, so each equals the `Attributes['metadata.*']` lookup it replaces. A missing key reads ''.
 */
export function traceAnalyticsMetadataColumns(
  trimmedAttributes: Readonly<Record<string, string>>,
): TraceAnalyticsMetadataColumns {
  const columns = {} as TraceAnalyticsMetadataColumns;
  for (const column of TRACE_ANALYTICS_METADATA_COLUMN_NAMES) {
    const keys: readonly string[] = TRACE_ANALYTICS_METADATA_KEYS[column];
    columns[column] = keys.map((key) => trimmedAttributes[key] ?? "").find(Boolean) ?? "";
  }
  return columns;
}

/** The span facts the stock widgets read out of a span's attribute maps. */
export interface SpanWidgetFacts {
  /** `langwatch.span.type`. */
  spanType: string;
  /** `exception.type`, else `error.type`. */
  errorType: string;
  /** The length of `langwatch.rag.contexts`; 0 when it is absent or not a JSON list. */
  ragContextCount: number;
  /** A 64-bit hash of `langwatch.input`, as a decimal string; 0 when the span sent none. */
  inputHash: string;
  /** The resource's `deployment.environment`, else `deployment.environment.name`. */
  deploymentEnvironment: string;
}

/**
 * One attribute as `stored_spans` stores it: text as is, a scalar stringified, anything else as
 * JSON, and '' when absent, so a fact equals the map lookup it replaces.
 */
function storedText(attributes: Readonly<Record<string, unknown>>, key: string): string {
  const value = attributes[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** ClickHouse's `JSONLength`: the items of a JSON list or the keys of an object, else 0. */
function jsonLength(text: string): number {
  if (text === "") return 0;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length;
    if (typeof parsed === "object" && parsed !== null) return Object.keys(parsed).length;
    return 0;
  } catch {
    return 0;
  }
}

/** The first 8 bytes of the input's SHA-256, unsigned; only equality is ever read. */
function inputHashOf(input: string): string {
  if (input === "") return "0";
  return createHash("sha256").update(input).digest().readBigUInt64BE(0).toString();
}

/** The widget facts of one normalized span, read from the maps `stored_spans` stores for it. */
export function spanWidgetFacts(
  span: Pick<NormalizedSpan, "spanAttributes" | "resourceAttributes">,
): SpanWidgetFacts {
  const attributes = span.spanAttributes;
  const resource = span.resourceAttributes;
  return {
    spanType: storedText(attributes, "langwatch.span.type"),
    errorType: storedText(attributes, "exception.type") || storedText(attributes, "error.type"),
    ragContextCount: jsonLength(storedText(attributes, "langwatch.rag.contexts")),
    inputHash: inputHashOf(storedText(attributes, "langwatch.input")),
    deploymentEnvironment:
      storedText(resource, "deployment.environment") ||
      storedText(resource, "deployment.environment.name"),
  };
}

/**
 * Where span_analytics is complete from: the replay's recorded since once done; while it runs,
 * the instant it began. A fresh install (not needed) is whole. With no row, or one not started,
 * older spans may be missing, so it fails safe as rebuilding, never as whole history.
 */
export function spanAnalyticsFloorOf(records: readonly LedgerStepRecord[]): SpanAnalyticsFloor {
  const [record] = records;
  if (!record) return { from: null, rebuilding: true };
  if (record.status === "not-needed") return { from: null, rebuilding: false };
  const since = projectionReplaySinceOf(record.report);
  if (record.status === "done" && since !== null) return { from: since, rebuilding: false };
  const from = record.startedAt ?? since;
  return { from, rebuilding: from === null };
}
