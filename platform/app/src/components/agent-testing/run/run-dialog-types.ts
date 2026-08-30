/**
 * What the run dialog is asked to run, and what its caller learns the moment
 * a run is queued.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { TargetValue } from "~/components/scenarios/TargetSelector";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { SuiteTarget } from "~/server/suites/types";
import type { RunScope } from "./run-configuration";

/**
 * One target the run goes against: the agent, and in a comparison the
 * overrides that target alone runs with.
 */
export type RunTarget = NonNullable<TargetValue> & {
  runParameters?: RunParameterValues;
};

/**
 * What the dialog is about to run.
 *
 * The first three arms fix the scope, so the dialog says nothing about what
 * runs. "plan" is the New run plan entry point, the one place the scope is
 * still being chosen. "case" fixes the scope to one scenario, and a run of it
 * goes out as an ordinary run plan named after that scenario and its agent.
 */
export type RunDialogSubject =
  | { kind: "plan"; initialTarget: TargetValue }
  | { kind: "all"; initialTarget: TargetValue }
  | {
      kind: "suite";
      suiteId: string;
      name: string;
      scenarioIds: string[];
      initialTarget: TargetValue;
      /**
       * What the subject covers, when it is a stored run plan rather than a
       * test suite. A test suite names none: it covers the scenarios filed in
       * it, which is the rule the dialog derives from its id.
       */
      scope?: RunScope;
      /**
       * The name the row already answers to as a run plan.
       *
       * The dialog opens on it unchanged. A plan is identified by its name,
       * and that name already ends with the target the plan runs against, so a
       * name derived again would end with the target twice and the run would
       * go out under a name no plan answers to, forking the plan.
       *
       * A test suite names none: it answers to no plan name, so a run of it
       * derives one from the scope and the target.
       */
      planName?: string;
      /**
       * The run options the suite carries from its last run: the target, its
       * bindings and its parameter overrides. The dialog opens on them, so a
       * repeat run is one click for everyone on the team.
       */
      persistedTarget?: SuiteTarget | null;
    }
  | {
      kind: "case";
      scenarioId: string;
      name: string;
      initialTarget: TargetValue;
    };

/** What the caller learns the moment a run is queued. */
export type RunStartedInfo = {
  batchRunId: string;
  /** The run set of the plan the batch landed in, known at queue time. */
  scenarioSetId: string;
  /** Set when the run covers one scenario: the case whose run to watch. */
  scenarioId?: string;
  /** Set when the run covers one scenario: the agent it went against. */
  targetId?: string;
};

export type RunDialogProps = {
  subject: RunDialogSubject | null;
  onClose: () => void;
  onRunStarted: (info: RunStartedInfo) => void;
};

/** Which list of targets the dialog offers: the agents, or the prompts. */
export type RunDialogMode = "agents" | "prompts";
