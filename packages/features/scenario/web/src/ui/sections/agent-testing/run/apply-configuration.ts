/**
 * Putting a stored configuration back into the run dialog.
 *
 * Shared by the two ways one arrives: picked from the run name dropdown, and
 * seeded when the dialog opens on the newest configuration of its scope.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { RunParameterValues } from "@langwatch/scenario-contract";
import type { SuiteTarget } from "@langwatch/suite-contract";
import type { CompareRow } from "./compare-rows";
import { formatStoredParameterLine } from "../../../../model/agent-testing/run/parameter-line";
import {
  type ParameterRow,
  rowsFromLine,
} from "../../../../model/agent-testing/run/parameter-rows";
import type { RunConfigurationEntry } from "./run-configuration";
import type { RunDialogFields } from "./use-run-dialog-form";
import type { RunPlanFields } from "./use-run-plan-fields";

/**
 * Whether a stored configuration is a comparison: several targets, every one
 * an agent. The rows of a comparison hold agents alone.
 */
function isComparison(targets: readonly SuiteTarget[]): boolean {
  return targets.length > 1 && targets.every((t) => t.type !== "prompt");
}

/**
 * The rows a stored comparison comes back as, each with its own overrides.
 *
 * A configuration stored before targets carried their own overrides holds
 * them at run level, copied onto every target, so a target without any reads
 * the run-level ones.
 */
function compareRowsOf({
  targets,
  runParameters,
}: {
  targets: readonly SuiteTarget[];
  runParameters: RunParameterValues;
}): CompareRow[] {
  return targets.map((target) => ({
    target: { type: target.type, id: target.referenceId },
    parameterLine: formatStoredParameterLine(target.runParameters ?? runParameters),
  }));
}

/**
 * The secret rows a configuration remembers. A run never writes a secret value
 * down, so a remembered secret row comes back by its name alone and the next
 * run asks for the value again.
 */
function secretRowsOf(primary: SuiteTarget | undefined): ParameterRow[] {
  return (primary?.runSecretParameterNames ?? []).map((name) => ({
    name,
    value: "",
    secret: true,
  }));
}

/**
 * Puts a configuration back into the dialog, opening the blocks it used and
 * folding away the ones it did not.
 *
 * The note text is left alone: it belongs to one run, not to a configuration.
 * A configuration that took a note before opens the note block ready and
 * empty, because the run plan takes a note every run and its words change
 * every run. The block only ever opens this way: a note somebody is already
 * writing is never taken away.
 */
export function applyConfigurationTo({
  entry,
  fields,
  planFields,
  pinRunName,
}: {
  entry: RunConfigurationEntry;
  fields: RunDialogFields;
  planFields: RunPlanFields;
  /**
   * Given when the person picked the entry themselves, which pins the name.
   * Left out when the dialog opened on the entry, so the name keeps following
   * the agent and the scope.
   */
  pinRunName?: (name: string) => void;
}) {
  const { configuration, runParameters } = entry;
  const [primary] = configuration.targets;
  const comparison = isComparison(configuration.targets);

  pinRunName?.(entry.planName);

  if (primary) {
    fields.setTarget({ type: primary.type, id: primary.referenceId });
    fields.setMode(primary.type === "prompt" ? "prompts" : "agents");
  }
  planFields.setCompareRows(
    comparison ? compareRowsOf({ targets: configuration.targets, runParameters }) : [],
  );

  // A comparison holds its plain values on the rows; only the secrets stay in
  // the parameter block, which is shared by every target.
  const hasParameters = !comparison && Object.keys(runParameters).length > 0;
  const line = hasParameters ? formatStoredParameterLine(runParameters) : "";
  const secretRows = secretRowsOf(primary);
  fields.setShowParams(hasParameters || secretRows.length > 0);
  fields.setParameterLine(line);
  // The dialog wrote this line, so it may be shortened again if the agent it
  // opens on cannot read what is on it.
  fields.setParameterLineTyped(false);
  fields.setParameterRows(secretRows.length > 0 ? [...rowsFromLine(line), ...secretRows] : null);
  fields.setRowsRequested(secretRows.length > 0);
  fields.setSecretValues({});

  planFields.setRepeatCount(configuration.repeatCount);
  planFields.setShowRepeat(configuration.repeatCount > 1);
  planFields.setSimulatorModel(configuration.simulatorModel);
  planFields.setJudgeModel(configuration.judgeModel);
  planFields.setShowModels(!!configuration.simulatorModel || !!configuration.judgeModel);

  if (entry.usesNote) fields.setShowNote(true);
}
