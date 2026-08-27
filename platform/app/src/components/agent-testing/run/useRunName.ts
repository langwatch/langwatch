/**
 * The name of the run, which follows what the dialog holds until the person
 * takes it over.
 *
 * The derived name is "<scope> <targets>", so a suite run against two agents
 * reads "Refunds dev-agent vs prod-agent". Typing a name, or picking one from
 * the dropdown, pins it and stops it following.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import type { PromptEntry } from "./PromptPicker";
import type { RunNameOption } from "./RunNameField";
import type { ScopeFolder, ScopeScenario } from "./RunScopeSection";
import type { RunDialogAgent } from "./RunTargetPicker";
import {
  deriveRunName,
  describeConfigurations,
  type RunConfigurationEntry,
  type RunScope,
} from "./run-configuration";
import type { RunDialogSubject } from "./run-dialog-types";

/** What one target is called, for the derived name and the dropdown rows. */
export function buildTargetLabels({
  agents,
  prompts,
}: {
  agents: readonly RunDialogAgent[];
  prompts: readonly PromptEntry[];
}): Map<string, string> {
  return new Map<string, string>([
    ...agents.map((agent) => [agent.id, agent.name] as const),
    // A prompt with no handle yet reads as its id rather than as nothing.
    ...prompts.map(
      (prompt) => [prompt.id, prompt.handle ?? prompt.id] as const,
    ),
  ]);
}

/**
 * What the scope is called in the run name.
 *
 * An entry point that fixed the scope already knows the words for it, so it
 * hands them in. Only the New run plan entry point derives them from the rule.
 */
export function scopeLabelOf({
  subject,
  scope,
  folders,
  scenarios,
}: {
  subject: RunDialogSubject;
  scope: RunScope;
  folders: readonly ScopeFolder[];
  scenarios: readonly ScopeScenario[];
}): string {
  if (subject.kind === "suite" || subject.kind === "case") return subject.name;
  if (scope.mode === "all") return "All scenarios";
  if (scope.mode === "folders") return folderScopeLabel({ scope, folders });
  if (scope.mode === "labels") {
    return scope.labels.length === 0
      ? "All scenarios"
      : scope.labels.join(", ");
  }
  return caseScopeLabel({ scope, scenarios });
}

/** The test suites a scope names, or how many of them there are. */
function folderScopeLabel({
  scope,
  folders,
}: {
  scope: Extract<RunScope, { mode: "folders" }>;
  folders: readonly ScopeFolder[];
}): string {
  const names = scope.folderIds.flatMap((folderId) => {
    const folder = folders.find((entry) => entry.id === folderId);
    return folder ? [folder.name] : [];
  });
  if (names.length === 0) return "All scenarios";
  if (names.length <= 2) return names.join(", ");
  return `${names.length} test suites`;
}

/** One hand-picked scenario reads by name; several read as a count. */
function caseScopeLabel({
  scope,
  scenarios,
}: {
  scope: Extract<RunScope, { mode: "cases" }>;
  scenarios: readonly ScopeScenario[];
}): string {
  if (scope.caseIds.length === 0) return "All scenarios";
  if (scope.caseIds.length === 1) {
    const only = scenarios.find((entry) => entry.id === scope.caseIds[0]);
    if (only) return only.name;
  }
  return `${scope.caseIds.length} scenarios`;
}

/** The targets of the run, in the order the derived name reads them. */
function labelsOfTargets({
  targets,
  targetLabels,
}: {
  targets: readonly NonNullable<TargetValue>[];
  targetLabels: ReadonlyMap<string, string>;
}): string[] {
  return targets.map((target) => targetLabels.get(target.id) ?? target.id);
}

export function useRunName({
  subjectKey,
  scopeLabel,
  targets,
  targetLabels,
  entries,
}: {
  /** One key per open of the dialog, so the name resets with the subject. */
  subjectKey: string;
  scopeLabel: string;
  targets: readonly NonNullable<TargetValue>[];
  targetLabels: ReadonlyMap<string, string>;
  /** The configurations this scope ran with, newest first. */
  entries: readonly RunConfigurationEntry[];
}) {
  // The name of one's own, or nothing while the name still follows the run.
  // Holding only the taken-over name keeps the field's value a plain read of
  // what the dialog holds, so it can never render one frame behind the agent
  // or the scope it names.
  const [takenOverName, setTakenOverName] = useState<string | null>(null);
  const openedOn = useRef(subjectKey);

  const derivedName = useMemo(
    () =>
      deriveRunName({
        scopeLabel,
        targetLabels: labelsOfTargets({ targets, targetLabels }),
      }),
    [scopeLabel, targets, targetLabels],
  );

  // The dialog opened on another subject: the name follows again.
  if (openedOn.current !== subjectKey) {
    openedOn.current = subjectKey;
    if (takenOverName !== null) setTakenOverName(null);
  }

  const runName = takenOverName ?? derivedName;

  /** Typing a name pins it, so it no longer follows the agent or the scope. */
  const setRunName = useCallback((value: string) => {
    setTakenOverName(value);
  }, []);

  /** Taking a name from the dropdown pins it the same way. */
  const pinRunName = useCallback((value: string) => {
    setTakenOverName(value);
  }, []);

  const options = useMemo((): RunNameOption[] => {
    const described = describeConfigurations({ entries, targetLabels });
    return entries.map((entry) => ({
      key: entry.key,
      name: entry.planName,
      detail: described.get(entry.key) ?? "",
      lastRunAt: entry.lastRunAt,
    }));
  }, [entries, targetLabels]);

  return { runName, setRunName, pinRunName, options };
}
