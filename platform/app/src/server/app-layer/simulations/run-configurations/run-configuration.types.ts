/**
 * What the run dialog offers back: the configurations a scope already ran with.
 *
 * The shape is the one the dropdown reads, entry for entry. It is deliberately
 * NOT the plan row: a plan row holds the configuration of its last run only,
 * and configuration identity is wider than plan identity, so two entries may
 * share a plan name and differ by parameters or repeat count alone.
 *
 * The run NOTE is not here. It is not part of a configuration, is never
 * carried over, and is never listed. `usesNote` is not the note: it says only
 * that a run of this configuration carried one, which is what tells the dialog
 * to open the note block ready and empty.
 *
 * @see specs/features/agent-testing/run-configuration-history.feature
 */

import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { SuiteTarget } from "~/server/suites/types";

/**
 * What a configuration covers, with the hand-picked list inside the rule.
 *
 * The stored scope names no cases, because a plan keeps its hand-picked list
 * in its own `scenarioIds` column. The dialog needs the list inside the rule,
 * so two hand-picked scopes over different scenarios read as two scopes.
 */
export type RunConfigurationScope =
  | { mode: "all" }
  | { mode: "folders"; folderIds: string[] }
  | { mode: "labels"; labels: string[] }
  | { mode: "cases"; caseIds: string[] };

/** Everything a picked entry puts back into the run dialog. */
export interface RunConfiguration {
  scope: RunConfigurationScope;
  /** Stably sorted, so "dev vs prod" and "prod vs dev" are one configuration. */
  targets: SuiteTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
}

/** One line of the Run name dropdown. */
export interface RunConfigurationEntry {
  /**
   * The configuration's identity, from the shared recipe in
   * `~/server/suites/plan-config`. One key per configuration, never per plan.
   */
  key: string;
  planId: string;
  planName: string;
  configuration: RunConfiguration;
  /** The parameter values this configuration ran with. */
  runParameters: RunParameterValues;
  /**
   * Whether a run of this configuration carried a note.
   *
   * A run plan that takes a note takes one every run, and the text changes
   * every run, so the fact is worth remembering and the text is not.
   */
  usesNote: boolean;
  /** When the newest run of this configuration started. */
  lastRunAt: Date;
}
