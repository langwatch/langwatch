/**
 * What the run dialog is asked to run, and what its caller learns the moment
 * a run is queued.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { TargetValue } from "../../scenarios/TargetSelector";
import type { SuiteTarget } from "@langwatch/suite-contract";

/** What the dialog is about to run. */
export type RunDialogSubject =
  | { kind: "all"; initialTarget: TargetValue }
  | {
      kind: "suite";
      suiteId: string;
      name: string;
      scenarioIds: string[];
      initialTarget: TargetValue;
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
