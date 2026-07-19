/**
 * Follow-up suggestions: what a result is worth DOING, derived from the feature
 * map's `produces` / `consumes` relation.
 *
 * Langy's AGENTS.md forbids the model from offering next actions in prose —
 * "Would you like me to add these to a dataset?" is banned. That is the right
 * rule (a model volunteering work is how an assistant becomes exhausting), but
 * the next action is still the most valuable thing on the screen. So the offer
 * has to come from the UI, driven by the structured result, not from the model's
 * mouth.
 *
 * The feature map already knows the relation that makes an offer sensible:
 * Tracing `produces: ["traces"]`; Datasets, Analytics, Annotations and Triggers
 * each `consumes: ["traces"]`. So a trace search that found something implies,
 * with no model involvement and no second table, exactly those offers. Add a
 * feature that consumes traces to the map and the offer appears; remove one and
 * it goes.
 *
 * This module returns DATA. Two things it deliberately does not do:
 *   - It renders nothing. `LangyCapabilityRenderer` draws the chips.
 *   - It carries nothing out. A suggestion is an offer; showing one must not
 *     create, mutate or persist anything (see the spec). Where an offer LANDS —
 *     the traces view already filtered, the graph builder with the search
 *     applied — is `features/langy/logic/traceQueryIntent.ts`'s job: it
 *     recompiles the tool call's INPUT into a destination URL. This module
 *     answers "which offers"; that one answers "to where".
 *
 * The copy lives HERE, not in the map: "Add to a dataset" is how the Langy panel
 * words it, and the map describes features, not one view's chips.
 *
 * @see specs/langy/langy-followup-suggestions.feature
 */
import { countResults } from "./cliResultDocument";
import { featureForCliToolName, featuresConsuming } from "~/shared/langy/featureMap";

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
 * The offers one settled tool result justifies: every feature that consumes a
 * resource kind this result produced, minus the feature that produced it (a
 * trace search does not offer to search traces).
 *
 * Nothing is offered on a failed call, a call still in flight, or a result that
 * found nothing — there is no "these" to act on.
 */
export function followUpsForResult(
  result: SettledToolResult,
): FollowUpSuggestion[] {
  if (result.state !== "output-available") return [];

  const source = featureForCliToolName(result.name);
  if (!source || source.produces.length === 0) return [];
  if (countResults(result.output) === 0) return [];

  const suggestions: FollowUpSuggestion[] = [];
  const seen = new Set<string>();

  for (const kind of source.produces) {
    for (const consumer of featuresConsuming(kind)) {
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
}: {
  results: SettledToolResult[];
}): FollowUpSuggestion[] {
  const suggestions: FollowUpSuggestion[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const suggestion of followUpsForResult(result)) {
      if (seen.has(suggestion.id)) continue;
      seen.add(suggestion.id);
      suggestions.push(suggestion);
    }
  }
  return suggestions;
}
