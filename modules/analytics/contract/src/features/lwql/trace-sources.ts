/**
 * A dashboard query's sources: the trace origins it counts (dashboards-v2 AC200). Lives here, not
 * beside `DEFAULT_TRACE_ORIGIN` in the trace contract, because the trace contract depends on this
 * package and the widget schema must check the enum.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The origins LangWatch stamps, in the order the editor shows them. */
export const KNOWN_TRACE_ORIGINS = [
  "application",
  "simulation",
  "evaluation",
  "coding_agent",
  "gateway",
  "workflow",
  "playground",
  "langy",
] as const;

/** Every origin not in {@link KNOWN_TRACE_ORIGINS}. An unstamped trace is `application`'s. */
export const OTHER_TRACE_SOURCE = "other";

export const TRACE_SOURCES = [...KNOWN_TRACE_ORIGINS, OTHER_TRACE_SOURCE] as const;
export type TraceSource = (typeof TRACE_SOURCES)[number];

/**
 * What a dashboard query counts while it stores no sources, and what a new widget's query is
 * created with (owner, 2026-10-28). The editor shows it as the query's pills.
 */
export const DEFAULT_WIDGET_SOURCES: readonly TraceSource[] = ["application"];

export const traceSourceSchema = z.enum(TRACE_SOURCES);
const traceSourcesSchemaDefinition = z.array(traceSourceSchema).max(TRACE_SOURCES.length);
export interface TraceSourcesSchema extends Named<typeof traceSourcesSchemaDefinition> {}
export const traceSourcesSchema: TraceSourcesSchema = traceSourcesSchemaDefinition;

/** The origin filter a picked set runs as: keep only `origins`, drop them, or keep every one. */
export type TraceSourceScope =
  | Readonly<{ kind: "include" | "exclude"; origins: readonly string[] }>
  | Readonly<{ kind: "every" }>;

/**
 * With `other` picked, the picked set is every origin but the known ones left out, so it runs
 * as an exclusion; without it, as an inclusion. An empty set includes nothing.
 */
export function traceSourceScope(sources: readonly TraceSource[]): TraceSourceScope {
  if (!sources.includes(OTHER_TRACE_SOURCE)) {
    return { kind: "include", origins: KNOWN_TRACE_ORIGINS.filter((o) => sources.includes(o)) };
  }
  const dropped = KNOWN_TRACE_ORIGINS.filter((o) => !sources.includes(o));
  return dropped.length === 0 ? { kind: "every" } : { kind: "exclude", origins: dropped };
}

/**
 * What a run names: a widget query's stored list, `null` for a widget query storing none (the
 * server counts {@link DEFAULT_WIDGET_SOURCES}), or absent for a run that is no widget's.
 */
export type RunSources = readonly TraceSource[] | null;

/** A query's sources as it runs: what it stores, else {@link DEFAULT_WIDGET_SOURCES}. */
export function effectiveSources(
  stored: readonly TraceSource[] | null | undefined,
): readonly TraceSource[] {
  return stored ?? DEFAULT_WIDGET_SOURCES;
}
