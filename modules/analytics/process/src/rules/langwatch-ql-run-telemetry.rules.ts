/**
 * What a LangWatchQL run's log line and metrics say of it: the caller, a keyed hash of the
 * statement that never carries its text, and how the run ended. Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { createHmac } from "node:crypto";

import type { LangWatchQLRunTelemetry } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";

import { selectNamedProjects } from "./langwatch-ql-project-selection.rules.ts";

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

/** The level a failed run is logged at. */
export type LangWatchQLFailureLevel = "info" | "warn" | "error";

/**
 * By the error's own fault, as the request logger does: a customer's refusal warns, ours or a
 * provider's is an error, a cancelled run is no failure, and an unhandled throw is a bug.
 */
export function langWatchQLFailureLevel(error: unknown): LangWatchQLFailureLevel {
  if (error instanceof HandledError) return error.fault === "customer" ? "warn" : "error";
  return langWatchQLFailureOutcome(error) === "aborted" ? "info" : "error";
}

/**
 * The projects a failed run's line names, each once: those it ran from, then any it named.
 * "all", or a stray word the run scope refuses, names none.
 */
export function langWatchQLRunProjectIds({
  own,
  named,
}: {
  own: readonly (string | undefined)[];
  named?: readonly string[] | "all" | undefined;
}): readonly string[] {
  const listed = selectNamedProjects({ projects: named }).named ?? [];
  const ids = [...own, ...listed].filter((id): id is string => typeof id === "string" && id !== "");
  return [...new Set(ids)];
}

/** The caller a run is counted under. */
export function langWatchQLTelemetryCaller(telemetry: LangWatchQLRunTelemetry | undefined): string {
  return telemetry?.caller ?? LWQL_UNNAMED_CALLER;
}

/**
 * The log line's own fields for a run: the caller, the first project (one value a log query
 * can group by) and all of them as an array, as the executed line has them, the widget's ids
 * when it has them, then the hash.
 */
export function langWatchQLTelemetryFields({
  telemetry,
  sql,
  queryHashKey,
  projectIds = [],
}: {
  telemetry: LangWatchQLRunTelemetry | undefined;
  sql: string;
  queryHashKey: Uint8Array;
  projectIds?: readonly string[];
}): Readonly<Record<string, string | readonly string[]>> {
  const [projectId] = projectIds;
  return {
    caller: langWatchQLTelemetryCaller(telemetry),
    ...(projectId === undefined ? {} : { projectId, projectIds }),
    ...(telemetry?.dashboardId === undefined ? {} : { dashboardId: telemetry.dashboardId }),
    ...(telemetry?.widgetId === undefined ? {} : { widgetId: telemetry.widgetId }),
    ...(telemetry?.templateId === undefined ? {} : { templateId: telemetry.templateId }),
    queryHash: langWatchQLQueryHash({ sql, key: queryHashKey }),
  };
}
