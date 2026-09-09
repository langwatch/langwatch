/**
 * What the agents and evaluators a saved workbench points at are called.
 *
 * A reader given only target ids cannot match a run's error ("Waiting on
 * category_classifier") to the column it belongs to, so the read path resolves
 * the same names the run does. Prompts come from the Prompt service the run
 * itself uses; agents and evaluators are rows this package does not own.
 *
 * Ids with no row are absent rather than null, so a deleted entity falls back
 * to the column id the rest of the projection is keyed by.
 */
export abstract class ExperimentTargetEntityNamesPort {
  abstract findAgentNames(input: {
    projectId: string;
    ids: string[];
  }): Promise<Record<string, string>>;
  abstract findEvaluatorNames(input: {
    projectId: string;
    ids: string[];
  }): Promise<Record<string, string>>;
}
