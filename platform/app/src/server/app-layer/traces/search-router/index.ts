/**
 * The production search router: the deployment's classifier, the FAST model
 * builders from `ai-query.ts`, the project's facet values for the context
 * line, and a counter for the decision. The decision table itself is in
 * `./route-search.ts`.
 */

import { type Counter, metrics } from "@opentelemetry/api";

import { getApp } from "~/server/app-layer/app";
import {
  getInstantEvalClassifier,
  isInstantEvalClassifierConfigured,
} from "~/server/app-layer/instant-evals/classifier";
import {
  generateInstantEvalQuestion,
  generateSearchRoute,
  generateTraceAction,
  type KnownProjectSignals,
} from "../ai-query";
import {
  createSearchRouter,
  type RouteSearchInput,
  type RouteSearchResult,
  type SearchRouteDecidedBy,
  type SearchRouteKind,
} from "./route-search";

const KNOWN_SIGNALS_LIMIT = 20;

/**
 * Evaluator and event names on the project in the window, from the same
 * facet values the sidebar shows. `allSettled`, so a slow facet costs the
 * context one list, never the search.
 */
async function listKnownSignals({
  projectId,
  timeRange,
}: {
  projectId: string;
  timeRange: { from: number; to: number };
}): Promise<KnownProjectSignals> {
  const app = getApp();
  const [evaluators, events] = await Promise.allSettled(
    ["evaluator", "event"].map((facetKey) =>
      app.traces.list.getFacetValues({
        tenantId: projectId,
        timeRange,
        facetKey,
        limit: KNOWN_SIGNALS_LIMIT,
        offset: 0,
      }),
    ),
  );
  const names = (
    settled: PromiseSettledResult<{ values: { value: string }[] }> | undefined,
  ): string[] =>
    settled?.status === "fulfilled"
      ? settled.value.values.map((entry) => entry.value)
      : [];
  return { evaluators: names(evaluators), events: names(events) };
}

let routeCounter: Counter | undefined;

/** Counted, never metered: one decision is below the spend spine's floor. */
function recordDecision(decision: {
  route: SearchRouteKind;
  decidedBy: SearchRouteDecidedBy;
}): void {
  routeCounter ??= metrics
    .getMeter("langwatch.trace-search-router")
    .createCounter("langwatch.trace_search.routes", {
      description:
        "Search-bar sentences routed on Enter, by route and by who decided",
    });
  routeCounter.add(1, {
    route: decision.route,
    decided_by: decision.decidedBy,
  });
}

export function routeSearch(
  input: RouteSearchInput,
): Promise<RouteSearchResult> {
  return createSearchRouter({
    classifier: isInstantEvalClassifierConfigured()
      ? getInstantEvalClassifier()
      : null,
    buildFilter: generateTraceAction,
    buildQuestion: generateInstantEvalQuestion,
    routeWithModel: generateSearchRoute,
    listKnownSignals,
    recordDecision,
  }).route(input);
}
