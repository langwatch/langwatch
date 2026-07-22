import {
  type LangySuggestion,
  SETUP_SUGGESTIONS,
  SUGGESTIONS,
} from "../components/EmptyState";

/**
 * What the project has reached, as far as choosing an ask is concerned.
 *
 * Deliberately three booleans rather than the raw check counts: this module
 * decides what to OFFER, and the only thing that bears on that is whether the
 * thing an ask needs exists at all.
 */
export interface ProjectReach {
  hasTraces: boolean;
  hasEvaluations: boolean;
  hasExperiments: boolean;
}

/** How many asks the home page's capability row shows. */
export const HOME_SUGGESTION_COUNT = 3;

/**
 * The asks a project can actually act on, best first.
 *
 * An empty project gets asks about getting started, because every ask about
 * traces, evaluations or runs is a dead end until it has some, and a row of
 * dead ends is the product lying on its own home page. As the project fills up
 * the row escalates: the ranking runs from the most demanding ask downward, so
 * the reader is always offered the most capable thing their data supports, and
 * a project with months of runs never gets shown "send your first trace".
 *
 * Pure, so the escalation can be tested without a project or a browser.
 *
 * Spec: specs/home/langy-home.feature
 */
export function selectHomeSuggestions(reach: ProjectReach): LangySuggestion[] {
  // Nothing at all: the only honest offer is help getting something in.
  if (!reach.hasTraces) return SETUP_SUGGESTIONS.slice(0, HOME_SUGGESTION_COUNT);

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

  // A project with traces but nothing else still has fewer than three asks it
  // can act on, so the setup list tops the row up rather than leaving a gap.
  const topUp = SETUP_SUGGESTIONS.filter(
    (setup) => !ordered.some((chosen) => chosen.label === setup.label),
  );
  return [...ordered, ...topUp].slice(0, HOME_SUGGESTION_COUNT);
}
