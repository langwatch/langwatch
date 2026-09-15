import type { Action } from "./context";
import * as actions from "./actions";
import { click, dismissTour, fill, go, select, type, wait } from "./primitives";

/**
 * Every action a flow step may name. The Go side validates visualdiff.yaml
 * against the same list (RunnerActions in tools/visualdiff/config.go), so a
 * typo is refused in a second rather than twenty minutes into a run — which is
 * exactly why the two lists have a test each holding them to the same names.
 */
export const REGISTRY: Record<string, Action> = {
  go,
  click,
  fill,
  select,
  type,
  wait,
  dismissTour,
  signIn: actions.signIn,
  createAutomation: actions.createAutomation,
  createEvaluation: actions.createEvaluation,
  sendTrace: actions.sendTrace,
  openTrace: actions.openTrace,
  annotate: actions.annotate,
  editProjectSettings: actions.editProjectSettings,
  createPrompt: actions.createPrompt,
  createExperiment: actions.createExperiment,
  createPairwise: actions.createPairwise,
  createScenario: actions.createScenario,
  createRunSet: actions.createRunSet,
  createDashboard: actions.createDashboard,
};

export const resolveAction = (name: string): Action => {
  const action = REGISTRY[name];
  if (action === undefined) {
    throw new Error(`unknown action "${name}" (known: ${Object.keys(REGISTRY).sort().join(", ")})`);
  }
  return action;
};
