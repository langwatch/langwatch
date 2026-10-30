/**
 * What a LangWatchQL run's log line and metrics say of it: the caller, a keyed hash of the
 * statement that never carries its text, and how the run ended. Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { createHmac } from "node:crypto";

import type { LangWatchQLRunTelemetry } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";

/** The caller a run that names none is counted under, so no run goes uncounted. */
export const LWQL_UNNAMED_CALLER = "unnamed";

/** How a run ended: rows came back, none did, or the code of the error that stopped it. */
export type LangWatchQLRunOutcome = "ok" | "empty" | (string & {});

/** What the query-hash key is derived under, so it never equals the deployment secret itself. */
const LWQL_QUERY_HASH_LABEL = "lwql-query-hash";

/**
 * The query-hash key: an HMAC of this label under the deployment secret. A key of its own, so a
 * log line never yields a hash made under the secret api-key hashes keys with.
 */
export function langWatchQLQueryHashKey(deploymentSecret: string): Buffer {
  return createHmac("sha256", deploymentSecret).update(LWQL_QUERY_HASH_LABEL).digest();
}

/**
 * An HMAC of the statement with its whitespace collapsed, so the same query written over more
 * lines reads as one. Keyed, so a log line cannot confirm a guessed statement and its literals
 * without the deployment's secret. Sixteen hex characters, and never the text.
 */
export function langWatchQLQueryHash({ sql, key }: { sql: string; key: Uint8Array }): string {
  const normalised = sql.trim().replace(/\s+/g, " ");
  return createHmac("sha256", key).update(normalised).digest("hex").slice(0, 16);
}

/** The bounded code an error is counted under: its handled code, or one word for the rest. */
export function langWatchQLFailureOutcome(error: unknown): LangWatchQLRunOutcome {
  if (error instanceof HandledError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "unhandled";
}

/** The caller a run is counted under. */
export function langWatchQLTelemetryCaller(telemetry: LangWatchQLRunTelemetry | undefined): string {
  return telemetry?.caller ?? LWQL_UNNAMED_CALLER;
}

/** The log line's own fields for a run: the caller, the widget's ids when it has them, the hash. */
export function langWatchQLTelemetryFields({
  telemetry,
  sql,
  queryHashKey,
}: {
  telemetry: LangWatchQLRunTelemetry | undefined;
  sql: string;
  queryHashKey: Uint8Array;
}): Readonly<Record<string, string>> {
  return {
    caller: langWatchQLTelemetryCaller(telemetry),
    ...(telemetry?.dashboardId === undefined ? {} : { dashboardId: telemetry.dashboardId }),
    ...(telemetry?.widgetId === undefined ? {} : { widgetId: telemetry.widgetId }),
    ...(telemetry?.templateId === undefined ? {} : { templateId: telemetry.templateId }),
    queryHash: langWatchQLQueryHash({ sql, key: queryHashKey }),
  };
}
