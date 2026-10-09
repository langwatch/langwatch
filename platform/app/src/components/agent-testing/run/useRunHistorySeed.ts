/**
 * The configuration a run dialog opens on.
 *
 * "Last used for that suite" is the newest configuration of the scope, which
 * the run plans hold. A test suite carries no run option of its own, so this
 * read is what preselects the target, the comparison, the parameter overrides,
 * the repeat count and the simulation models.
 *
 * A subject that brought its own remembered configuration takes only one fact
 * from the read: whether the plan takes a note. A suite row holds no note, and
 * the words of a note belong to one run.
 *
 * The seed never pins the run name: the name keeps following the agent and the
 * scope until the person types one or picks an entry from the list. A stored
 * run plan opens on its own name, which the name field does for itself.
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

/** Whether the subject arrived with the run options of its own last run. */
function broughtOwnConfiguration(subject: RunDialogSubject): boolean {
  return subject.kind === "suite" && !!subject.persistedTarget;
}

/**
 * What opening the dialog on this subject does to the fields.
 *
 * "wait" is not a decision: the fields have not been reset for this subject
 * yet, or the read has not answered, so nothing is settled and the next render
 * asks again.
 */
type Seed =
  | { kind: "wait" }
  | { kind: "nothing" }
  | { kind: "note"; usesNote: boolean }
  | { kind: "configuration"; entry: RunConfigurationEntry };

/**
 * The newest configuration this plan itself ran, whatever the scope ran since.
 *
 * A scope can hold several plans, so the newest entry of the scope may belong
 * to another one.
 */
function ownEntryOf({
  subject,
  entries,
}: {
  subject: RunDialogSubject;
  entries: readonly RunConfigurationEntry[];
}): RunConfigurationEntry | null {
  if (subject.kind !== "suite") return null;
  return entries.find((entry) => entry.planId === subject.suiteId) ?? null;
}

/**
 * What the dialog opens on.
 *
 * A subject that brought its own remembered configuration opens on that one,
 * whatever the scope ran with since. Only the note is missing from it: a suite
 * row holds no note, so whether the plan takes one is read off the plan's own
 * runs. Opening the note block adds an empty field and takes nothing away, so
 * it needs no guard on what the dialog already holds.
 */
function seedFor({
  subject,
  subjectKey,
  entries,
  isLoaded,
  fields,
  planFields,
}: {
  subject: RunDialogSubject;
  subjectKey: string;
  entries: readonly RunConfigurationEntry[];
  isLoaded: boolean;
  fields: RunDialogFields;
  planFields: RunPlanFields;
}): Seed {
  // The fields hold the previous subject until their own reset has run.
  if (fields.resetFor !== subjectKey || !isLoaded) return { kind: "wait" };

  if (broughtOwnConfiguration(subject)) {
    const own = ownEntryOf({ subject, entries });
    return { kind: "note", usesNote: own?.usesNote === true };
  }

  if (!isUntouched({ subject, fields, planFields })) return { kind: "nothing" };
  const newest = entries[0];
  return newest
    ? { kind: "configuration", entry: newest }
    : { kind: "nothing" };
}

/** Puts a settled seed into the dialog. */
function applySeed({
  seed,
  fields,
  planFields,
}: {
  seed: Seed;
  fields: RunDialogFields;
  planFields: RunPlanFields;
}): void {
  if (seed.kind === "note" && seed.usesNote) fields.setShowNote(true);
  if (seed.kind === "configuration") {
    applyConfigurationTo({ entry: seed.entry, fields, planFields });
  }
}

export function useRunHistorySeed({
  subject,
  subjectKey,
  entries,
  isLoaded,
  fields,
  planFields,
}: {
  subject: RunDialogSubject | null;
  subjectKey: string;
  /** The configurations of this scope, newest first. */
  entries: readonly RunConfigurationEntry[];
  /** Whether the read has answered. The dialog opens on what it says. */
  isLoaded: boolean;
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

    const seed = seedFor({
      subject,
      subjectKey,
      entries,
      isLoaded,
      fields,
      planFields,
    });
    if (seed.kind === "wait") return;

    seededKey.current = subjectKey;
    applySeed({ seed, fields, planFields });
  }, [subject, subjectKey, entries, isLoaded, fields, planFields]);
}
