import * as actions from "./actions";
import type { Action } from "./context";
import { click, dismissTour, fill, go, select, type, wait } from "./primitives";

/** Keep names aligned with `RunnerActions` in tools/visualdiff/config.go; tests enforce parity. */
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
    throw new Error(
      `unknown action "${name}" (known: ${Object.keys(REGISTRY).toSorted().join(", ")})`,
    );
  }
  return action;
};
