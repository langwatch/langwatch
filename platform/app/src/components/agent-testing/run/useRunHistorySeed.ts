/**
 * The configuration a run dialog opens on.
 *
 * "Last used for that suite" is the newest configuration of the scope, which
 * the run plans hold. A test suite carries no run option of its own, so this
 * read is what preselects the target, the comparison, the parameter overrides,
 * the repeat count and the simulation models.
 *
 * The seed never pins the run name: the name keeps following the agent and the
 * scope until the person types one or picks an entry from the list.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useEffect, useRef } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { applyConfigurationTo } from "./apply-configuration";
import type { RunConfigurationEntry } from "./run-configuration";
import type { RunDialogSubject } from "./run-dialog-types";
import type { RunDialogFields } from "./useRunDialogForm";
import type { RunPlanFields } from "./useRunPlanFields";

/** Whether the dialog still holds exactly what it opened with. */
function isUntouched({
  subject,
  fields,
  planFields,
}: {
  subject: RunDialogSubject;
  fields: RunDialogFields;
  planFields: RunPlanFields;
}): boolean {
  return (
    isSameTarget(fields.target, subject.initialTarget) &&
    !fields.showParams &&
    !fields.showNote &&
    !planFields.showCompare &&
    !planFields.showRepeat &&
    !planFields.showModels
  );
}

function isSameTarget(left: TargetValue, right: TargetValue): boolean {
  if (!left || !right) return left === right;
  return left.type === right.type && left.id === right.id;
}

/**
 * The configuration to open on: the newest of the scope, nothing when the
 * subject brought its own, and "wait" while the read is still on its way.
 */
function seedFor({
  subject,
  entries,
}: {
  subject: RunDialogSubject;
  entries: readonly RunConfigurationEntry[];
}): RunConfigurationEntry | null | "wait" {
  // A subject that brought its own remembered configuration opens on that one,
  // whatever the scope ran with since.
  if (subject.kind === "suite" && subject.persistedTarget) return null;
  return entries[0] ?? "wait";
}

export function useRunHistorySeed({
  subject,
  subjectKey,
  entries,
  fields,
  planFields,
}: {
  subject: RunDialogSubject | null;
  subjectKey: string;
  /** The configurations of this scope, newest first. */
  entries: readonly RunConfigurationEntry[];
  fields: RunDialogFields;
  planFields: RunPlanFields;
}): void {
  // One seed per open of the dialog. The history arrives after the first
  // render, so this cannot be part of the reset.
  const seededKey = useRef<string | null>(null);

  useEffect(() => {
    if (!subject) {
      seededKey.current = null;
      return;
    }
    if (seededKey.current === subjectKey) return;
    // Still waiting for the read; a scope with no history never seeds at all.
    const newest = seedFor({ subject, entries });
    if (newest === "wait") return;

    seededKey.current = subjectKey;
    if (!newest) return;
    if (!isUntouched({ subject, fields, planFields })) return;
    applyConfigurationTo({ entry: newest, fields, planFields });
  }, [subject, subjectKey, entries, fields, planFields]);
}
