/**
 * What a LangWatchQL run's log line and metrics say of it: the caller, a hash of the statement
 * that never carries its text, and how the run ended. Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { createHash } from "node:crypto";

import type { LangWatchQLRunTelemetry } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";

/** The caller a run that names none is counted under, so no run goes uncounted. */
export const LWQL_UNNAMED_CALLER = "unnamed";

/** How a run ended: rows came back, none did, or the code of the error that stopped it. */
export type LangWatchQLRunOutcome = "ok" | "empty" | (string & {});

/**
 * A hash of the statement with its whitespace collapsed, so the same query written over more
 * lines reads as one. Sixteen hex characters: enough to tell slow queries apart in the logs,
 * and never the text, which can carry a customer's literals.
 */
export function langWatchQLQueryHash(sql: string): string {
  const normalised = sql.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
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
}: {
  telemetry: LangWatchQLRunTelemetry | undefined;
  sql: string;
}): Readonly<Record<string, string>> {
  return {
    caller: langWatchQLTelemetryCaller(telemetry),
    ...(telemetry?.dashboardId === undefined ? {} : { dashboardId: telemetry.dashboardId }),
    ...(telemetry?.widgetId === undefined ? {} : { widgetId: telemetry.widgetId }),
    ...(telemetry?.templateId === undefined ? {} : { templateId: telemetry.templateId }),
    queryHash: langWatchQLQueryHash(sql),
  };
}
