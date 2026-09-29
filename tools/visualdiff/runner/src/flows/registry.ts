import * as actions from "./actions.ts";
import type { Action } from "./context.ts";
import { expectOutcome } from "./expect.ts";
import { capture, drag, upload } from "./interactions.ts";
import { mail } from "./mail.ts";
import { click, dismissTour, fill, go, select, type, wait } from "./primitives.ts";

/** Keep names aligned with `RunnerActions` in tools/visualdiff/config.go; tests enforce parity. */
export const REGISTRY: Record<string, Action> = {
  go,
  click,
  fill,
  select,
  type,
  wait,
  dismissTour,
  expect: expectOutcome,
  upload,
  drag,
  capture,
  mail,
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
