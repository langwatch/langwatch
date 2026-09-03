/**
 * The name of the run, which follows what the dialog holds until the person
 * takes it over.
 *
 * The derived name is "<scope> <targets>", so a suite run against two agents
 * reads "Refunds dev-agent vs prod-agent". Typing a name, or picking one from
 * the dropdown, pins it and stops it following.
 *
 * A dialog opened on a stored run plan opens on the plan's own name, pinned
 * from the first render. The plan already answers to that name, and deriving
 * one again would append the target to a name that ends with it.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { PromptEntry } from "./prompt-picker";
import type { RunNameOption } from "./run-name-field";
import type { ScopeScenario, ScopeTestSuite } from "./run-scope-section";
import type { RunDialogAgent } from "./run-target-picker";
import {
  deriveRunName,
  describeConfigurations,
  type RunConfigurationEntry,
  type RunScope,
  sortedTargetLabels,
} from "./run-configuration";
import type { RunDialogSubject, RunTarget } from "./run-dialog-types";

/** What one target is called, for the derived name and the dropdown rows. */
export function buildTargetLabels({
  agents,
  prompts,
}: {
  agents: readonly RunDialogAgent[];
  prompts: readonly PromptEntry[];
}): Map<string, string> {
  return new Map<string, string>([
    ...agents.map((agent) => [agent.id, agent.label ?? agent.name] as const),
    // A prompt with no handle yet reads as its id rather than as nothing.
    ...prompts.map((prompt) => [prompt.id, prompt.handle ?? prompt.id] as const),
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
  testSuites,
  scenarios,
}: {
  subject: RunDialogSubject;
  scope: RunScope;
  testSuites: readonly ScopeTestSuite[];
  scenarios: readonly ScopeScenario[];
}): string {
  if (subject.kind === "suite" || subject.kind === "case") return subject.name;
  if (scope.mode === "all") return "All scenarios";
  if (scope.mode === "test_suites") return testSuiteScopeLabel({ scope, testSuites });
  if (scope.mode === "labels") {
    return scope.labels.length === 0 ? "All scenarios" : scope.labels.join(", ");
  }
  return scenarioScopeLabel({ scope, scenarios });
}

/** The test suites a scope names, or how many of them there are. */
function testSuiteScopeLabel({
  scope,
  testSuites,
}: {
  scope: Extract<RunScope, { mode: "test_suites" }>;
  testSuites: readonly ScopeTestSuite[];
}): string {
  const names = scope.testSuiteIds.flatMap((testSuiteId) => {
    const testSuite = testSuites.find((entry) => entry.id === testSuiteId);
    return testSuite ? [testSuite.name] : [];
  });
  if (names.length === 0) return "All scenarios";
  if (names.length <= 2) return names.join(", ");
  return `${names.length} test suites`;
}

/**
 * One hand-picked scenario reads by its own name; several read as a count.
 *
 * A run of one scenario is named after that scenario, always. A count in its
 * place says how many ran and never which, so "1 scenario dev-agent" names
 * every single-scenario run of that agent the same thing and they all resolve
 * onto one run plan.
 */
function scenarioScopeLabel({
  scope,
  scenarios,
}: {
  scope: Extract<RunScope, { mode: "scenarios" }>;
  scenarios: readonly ScopeScenario[];
}): string {
  if (scope.scenarioIds.length === 0) return "All scenarios";
  if (scope.scenarioIds.length === 1) {
    const only = scenarios.find((entry) => entry.id === scope.scenarioIds[0]);
    // The scenario list is still on its way, or holds no scenario of that id.
    return only?.name ?? "Selected scenario";
  }
  return `${scope.scenarioIds.length} scenarios`;
}

/**
 * The targets of the run, in the order the derived name reads them: the order
 * the run plan sorts them in, so the name is the plan's name whichever row
 * was picked first.
 */
function labelsOfTargets({
  targets,
  targetLabels,
}: {
  targets: readonly RunTarget[];
  targetLabels: ReadonlyMap<string, string>;
}): string[] {
  return sortedTargetLabels({
    targets: targets.map((target) => ({
      type: target.type,
      referenceId: target.id,
      ...(target.runParameters ? { runParameters: target.runParameters } : {}),
    })),
    targetLabels,
    fallbackLabel: (target) => target.referenceId,
  });
}

export function useRunName({
  subjectKey,
  planName,
  scopeLabel,
  targets,
  targetLabels,
  entries,
}: {
  /** One key per open of the dialog, so the name resets with the subject. */
  subjectKey: string;
  /** The name of the stored run plan the dialog opened on, if it opened on one. */
  planName: string | null;
  scopeLabel: string;
  targets: readonly RunTarget[];
  targetLabels: ReadonlyMap<string, string>;
  /** The configurations this scope ran with, newest first. */
  entries: readonly RunConfigurationEntry[];
}) {
  // The name of one's own, or nothing while the name still follows the run. A
  // stored run plan starts here, because its name is already its own.
  // Holding only the taken-over name keeps the field's value a plain read of
  // what the dialog holds, so it can never render one frame behind the agent
  // or the scope it names.
  const [takenOverName, setTakenOverName] = useState<string | null>(planName);
  const openedOn = useRef(subjectKey);

  const derivedName = useMemo(
    () =>
      deriveRunName({
        scopeLabel,
        targetLabels: labelsOfTargets({ targets, targetLabels }),
      }),
    [scopeLabel, targets, targetLabels],
  );

  // The dialog opened on another subject: the name follows again, unless the
  // subject is a stored run plan, whose own name it opens on.
  if (openedOn.current !== subjectKey) {
    openedOn.current = subjectKey;
    if (takenOverName !== planName) setTakenOverName(planName);
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
