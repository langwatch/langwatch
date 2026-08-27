/**
 * Putting a stored configuration back into the run dialog.
 *
 * Shared by the two ways one arrives: picked from the run name dropdown, and
 * seeded when the dialog opens on the newest configuration of its scope.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { formatStoredParameterLine } from "./parameter-line";
import { rowsFromLine } from "./parameter-rows";
import type { RunConfigurationEntry } from "./run-configuration";
import type { RunDialogFields } from "./useRunDialogForm";
import type { RunPlanFields } from "./useRunPlanFields";

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
  const [primary, second] = configuration.targets;

  pinRunName?.(entry.planName);

  if (primary) {
    fields.setTarget({ type: primary.type, id: primary.referenceId });
    fields.setMode(primary.type === "prompt" ? "prompts" : "agents");
  }
  planFields.setShowCompare(!!second);
  planFields.setCompareTarget(
    second ? { type: second.type, id: second.referenceId } : null,
  );

  const hasParameters = Object.keys(runParameters).length > 0;
  const line = hasParameters ? formatStoredParameterLine(runParameters) : "";
  // A run never writes a secret value down, so a remembered secret row comes
  // back by its name alone and the next run asks for the value again.
  const secretRows = (primary?.runSecretParameterNames ?? []).map((name) => ({
    name,
    value: "",
    secret: true,
  }));
  fields.setShowParams(hasParameters || secretRows.length > 0);
  fields.setParameterLine(line);
  fields.setParameterRows(
    secretRows.length > 0 ? [...rowsFromLine(line), ...secretRows] : null,
  );
  fields.setRowsRequested(secretRows.length > 0);
  fields.setSecretValues({});

  planFields.setRepeatCount(configuration.repeatCount);
  planFields.setShowRepeat(configuration.repeatCount > 1);
  planFields.setSimulatorModel(configuration.simulatorModel);
  planFields.setJudgeModel(configuration.judgeModel);
  planFields.setShowModels(
    !!configuration.simulatorModel || !!configuration.judgeModel,
  );

  if (entry.usesNote) fields.setShowNote(true);
}
