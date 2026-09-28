/**
 * What a dashboard block is: a titled card fed by one data source and one or
 * more LangWatchQL statements, drawn by one view. Pure: no React, no fetching.
 */

import {
  LWQL_ACCEPTED_GRANULARITY_STEPS,
  LWQL_GRANULARITY_MAX_BUCKETS,
  type LangWatchQLAcceptedGranularityStep,
} from "@langwatch/analytics-contract";
import { z } from "zod";

/**
 * The integrations a block can depend on; each lights up once it has ever
 * recorded a row, as `dashboards.sourcePresence` answers for the whole board.
 */
export const blockSourceSchema = z.enum([
  "traces",
  "scenarios",
  "judges",
  "feedback",
  "gateway",
  "codingAgents",
]);
export type BlockSource = z.infer<typeof blockSourceSchema>;

/**
 * How a block draws its rows: generic charts for library blocks, one view
 * per Flight Deck panel.
 */
export const blockViewSchema = z.enum([
  "line",
  "ranking",
  "status",
  "throughput",
  "costEfficiency",
  "failures",
  "scenarios",
  "quality",
  "feedback",
  "gateway",
  "codingAgents",
  "impactfulTraces",
]);
export type BlockView = z.infer<typeof blockViewSchema>;

/** How a generic view formats its numbers. */
export const blockUnitSchema = z.enum(["count", "usd", "ms", "ratio", "tokens", "score"]);
export type BlockUnit = z.infer<typeof blockUnitSchema>;

export const blockQuerySchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  sql: z.string().min(1),
});
export type BlockQuery = z.infer<typeof blockQuerySchema>;

export const blockDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  source: blockSourceSchema,
  width: z.enum(["full", "half"]),
  view: blockViewSchema,
  unit: blockUnitSchema.optional(),
  queries: z.array(blockQuerySchema).min(1),
});
export type BlockDefinition = z.infer<typeof blockDefinitionSchema>;

/** What an unconnected source invites the member to do, and where the button goes. */
export interface SourceCallToAction {
  readonly title: string;
  readonly line: string;
  readonly button: string;
  readonly target: (projectSlug: string) => string;
}

export const SOURCE_CALLS_TO_ACTION: Readonly<Record<BlockSource, SourceCallToAction>> = {
  traces: {
    title: "Connect traces to light up the flight deck",
    line: "Once traces flow in you'll see request volume, success rate, p95 latency, cost and the traces that explain every spike.",
    button: "Connect traces",
    target: (slug) => `/${slug}/traces`,
  },
  scenarios: {
    title: "Run a scenario",
    line: "Scenario pass rate and coverage across your suites, so you know what behaviour is actually tested.",
    button: "Run a scenario",
    target: (slug) => `/${slug}/simulations/scenarios`,
  },
  judges: {
    title: "Add a judge",
    line: "Evaluator pass rate plotted against latency and cost, so you can see quality move with load.",
    button: "Add a judge",
    target: (slug) => `/${slug}/online-evaluations`,
  },
  feedback: {
    title: "Collect feedback",
    line: "Thumbs and annotations from your users, tracked over time next to quality and cost.",
    button: "Collect feedback",
    target: (slug) => `/${slug}/annotations`,
  },
  gateway: {
    title: "Route via the Gateway",
    line: "Cost broken down by virtual key / route, so you can see which integration is spending.",
    button: "Route via Gateway",
    target: () => "/gateway/virtual-keys",
  },
  codingAgents: {
    title: "Connect your coding agents",
    line: "Connect your coding agent to see this.",
    button: "Connect",
    target: (slug) => `/${slug}/sessions`,
  },
};

/** Relative change against the previous period; no previous value means no change to show. */
export function periodDelta({ current, previous }: { current: number; previous: number }): number {
  return previous > 0 ? (current - previous) / previous : 0;
}

/** A change against the previous period, or "new" when that period had nothing. */
export type PeriodChange = number | "new";

/** As {@link periodDelta}, except a figure the previous period lacked reads as new. */
export function periodChange({
  current,
  previous,
}: {
  current: number;
  previous: number;
}): PeriodChange {
  if (previous <= 0 && current > 0) return "new";
  return periodDelta({ current, previous });
}

/**
 * The finest accepted step, up to a week, at or above the request that keeps
 * the period within the bucket budget.
 */
export function fitGranularity({
  periodStart,
  periodEnd,
  requested,
}: {
  periodStart: number;
  periodEnd: number;
  requested: number;
}): LangWatchQLAcceptedGranularityStep {
  const seconds = Math.max(1, (periodEnd - periodStart) / 1000);
  const fitting = LWQL_ACCEPTED_GRANULARITY_STEPS.find(
    (step) => step >= requested && seconds / step <= LWQL_GRANULARITY_MAX_BUCKETS,
  );
  return fitting ?? LWQL_ACCEPTED_GRANULARITY_STEPS[LWQL_ACCEPTED_GRANULARITY_STEPS.length - 1]!;
}

/** Where a request stands, as a panel needs to know it. */
export type RequestStatus = "pending" | "error" | "success";

export type BlockState = "loading" | "notConnected" | "error" | "empty" | "data";

/**
 * Which of the five faces a block shows. A source that has never recorded a
 * row invites the member to connect it; a connected source with nothing in
 * the period is empty; a failed request is an error, never empty (AC9, AC23).
 */
export function blockState({
  sourceStatus,
  connected,
  dataStatus,
  hasRows,
}: {
  sourceStatus: RequestStatus;
  connected: boolean;
  dataStatus: RequestStatus;
  hasRows: boolean;
}): BlockState {
  if (sourceStatus === "error") return "error";
  if (sourceStatus === "pending") return "loading";
  if (!connected) return "notConnected";
  if (dataStatus === "error") return "error";
  if (dataStatus === "pending") return "loading";
  return hasRows ? "data" : "empty";
}
