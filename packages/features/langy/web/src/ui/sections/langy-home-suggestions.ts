import { type LangySuggestion, SETUP_SUGGESTIONS, SUGGESTIONS } from "./langy-empty-state";

/**
 * What the project has reached, as far as choosing an ask is concerned.
 */
export interface ProjectReach {
  hasTraces: boolean;
  hasEvaluations: boolean;
  hasExperiments: boolean;
}

/**
 * How many asks the home page's capability row shows.
 */
export const HOME_SUGGESTION_COUNT = 3;

/**
 * How many asks the panel's empty state shows — its historical four rows, so a
 * project that has reached everything still sees the full range in the place
 * where people learn what Langy can do.
 */
export const PANEL_SUGGESTION_COUNT = 4;

/**
 * The asks a project can actually act on, best first.
 * Spec: specs/home/langy-home.feature,
 * specs/langy/langy-empty-state-suggestions.feature
 */
export function selectLangySuggestions({
  reach,
  count = HOME_SUGGESTION_COUNT,
}: {
  reach: ProjectReach;
  count?: number;
}): LangySuggestion[] {
  const met = (requirement: LangySuggestion["requires"]): boolean => {
    switch (requirement) {
      case "traces":
        return reach.hasTraces;
      case "evaluations":
        return reach.hasEvaluations;
      case "experiments":
        return reach.hasExperiments;
      default:
        return true;
    }
  };

  // A setup ask whose gap has closed is obsolete — offering it anyway is the
  // product not knowing its own customer.
  const stillNeeded = (suggestion: LangySuggestion): boolean =>
    suggestion.until === undefined || !met(suggestion.until);

  // Nothing at all: the only honest offer is help getting something in.
  if (!reach.hasTraces) {
    return SETUP_SUGGESTIONS.filter(stillNeeded).slice(0, count);
  }

  // Most demanding first, so the row leads with the most capable ask the
  // project supports rather than whichever happened to be written first.
  const rank: Record<string, number> = {
    experiments: 3,
    evaluations: 2,
    traces: 1,
  };
  const available = SUGGESTIONS.filter((suggestion) => met(suggestion.requires));
  const ordered = available.toSorted(
    (a, b) => (rank[b.requires ?? ""] ?? 0) - (rank[a.requires ?? ""] ?? 0),
  );

  // A project with traces but nothing else still has fewer asks it can act on
  // than the row holds, so the setup list tops the row up rather than leaving
  // a gap — but only with the setup asks the project still needs.
  const topUp = SETUP_SUGGESTIONS.filter(
    (setup) => stillNeeded(setup) && !ordered.some((chosen) => chosen.label === setup.label),
  );
  return [...ordered, ...topUp].slice(0, count);
}
