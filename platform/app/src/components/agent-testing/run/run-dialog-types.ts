/**
 * What the run dialog is asked to run, and what its caller learns the moment
 * a run is queued.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { TargetValue } from "~/components/scenarios/TargetSelector";
import type { SuiteTarget } from "~/server/suites/types";
import type { RunScope } from "./run-configuration";

/**
 * What the dialog is about to run.
 *
 * The first three arms fix the scope, so the dialog says nothing about what
 * runs. "plan" is the New run plan entry point, the one place the scope is
 * still being chosen.
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
  /** The run set the batch lands in, when it is known at queue time. */
  scenarioSetId?: string;
  /** Set on a one-off run: the case whose run to watch. */
  scenarioId?: string;
  /** Set on a one-off run: the agent it went against. */
  targetId?: string;
};

export type RunDialogProps = {
  subject: RunDialogSubject | null;
  onClose: () => void;
  onRunStarted: (info: RunStartedInfo) => void;
  /** A one-off run finished its start-up poll, well or not. */
  onCaseRunSettled?: (scenarioId: string) => void;
};

/** Which list of targets the dialog offers: the agents, or the prompts. */
export type RunDialogMode = "agents" | "prompts";
