/**
 * Follow-up suggestions: what a result is worth DOING, derived from the feature map's
 * `produces` / `consumes` relation.
 * @see specs/langy/langy-followup-suggestions.feature
 */

import type { LangyFeatureMap } from "./langy-feature-map";
import { countResults } from "./langy-cli-result-document";

/** A settled tool call from the turn, as the UI already models it. */
export interface SettledToolResult {
  /** The CLI envelope's typed name, e.g. `langwatch.trace.search`. */
  name: string;
  /** AI-SDK tool state. Only `output-available` can be built upon. */
  state: string;
  /** The tool's settled output — the CLI's JSON document. */
  output: unknown;
}

/** One offer, as data. The UI decides how (and whether) to draw it. */
export interface FollowUpSuggestion {
  /** Stable per (result kind, target feature) — safe as a React key. */
  id: string;
  /** The feature that would ACT on the result. */
  featureId: string;
  featureName: string;
  /** The chip's copy. */
  label: string;
  /** The resource kind that justified the offer ("traces"). */
  kind: string;
  /** The tool call whose result this is an offer on. */
  sourceToolName: string;
}

/**
 * How the Langy panel words each feature's offer. Keyed by feature id, so a
 * feature the map says consumes something but that has no copy here is simply
 * not offered — a chip reading "Use in Online Evaluation" is worse than no chip.
 */
export const SUGGESTION_LABEL: Record<string, string> = {
  "library.datasets": "Add to a dataset",
  "observability.analytics": "Graph these",
  "observability.annotations": "Send for annotation",
  triggers: "Alert me on this",
  "evaluations.experiments": "Run an experiment",
  "agent-simulations.scenarios": "Simulate this",
  dashboards: "Pin to a dashboard",
  "evaluations.online-evaluation": "Run this on live traffic",
};

/**
 * Result kinds that justify NO offers, even where the map names consumers.
 */
const UNOFFERABLE_KINDS: ReadonlySet<string> = new Set(["evaluators", "prompts"]);

/**
 * The offers one settled tool result justifies: every feature that consumes a resource
 * kind this result produced, minus the feature that produced it (a trace search does
 * not offer to search traces).
 */
export function followUpsForResult(
  result: SettledToolResult,
  featureMap?: Pick<LangyFeatureMap, "featureForCliToolName" | "featuresConsuming">,
): FollowUpSuggestion[] {
  if (result.state !== "output-available") return [];

  const source = featureMap?.featureForCliToolName(result.name);
  if (!source || source.produces.length === 0) return [];
  if (countResults(result.output) === 0) return [];

  const suggestions: FollowUpSuggestion[] = [];
  const seen = new Set<string>();

  for (const kind of source.produces) {
    if (UNOFFERABLE_KINDS.has(kind)) continue;
    for (const consumer of featureMap?.featuresConsuming(kind) ?? []) {
      if (consumer.id === source.id) continue;

      const label = SUGGESTION_LABEL[consumer.id];
      if (!label) continue;

      const id = `${kind}:${consumer.id}`;
      if (seen.has(id)) continue;
      seen.add(id);

      suggestions.push({
        id,
        featureId: consumer.id,
        featureName: consumer.name,
        label,
        kind,
        sourceToolName: result.name,
      });
    }
  }
  return suggestions;
}

/**
 * The offers a whole turn justifies, in first-seen order and deduped across its
 * tool calls — two trace searches in one turn offer "Add to a dataset" once.
 */
export function deriveFollowUps({
  results,
  featureMap,
}: {
  results: SettledToolResult[];
  featureMap?: Pick<LangyFeatureMap, "featureForCliToolName" | "featuresConsuming">;
}): FollowUpSuggestion[] {
  const suggestions: FollowUpSuggestion[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const suggestion of followUpsForResult(result, featureMap)) {
      if (seen.has(suggestion.id)) continue;
      seen.add(suggestion.id);
      suggestions.push(suggestion);
    }
  }
  return suggestions;
}
