/**
 * The fields of the run dialog that describe the run itself rather than the
 * agent: what it covers, the targets it compares, the simulation models, and
 * how many times it repeats.
 *
 * They reset once per subject, the same way the rest of the dialog does.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { useEffect, useState } from "react";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import type { CompareRow } from "./compare-rows";
import type { RunScope } from "./run-configuration";
import type { RunDialogSubject } from "./run-dialog-types";

/** What the entry point already decided the run covers. */
export function initialScopeOf(subject: RunDialogSubject | null): RunScope {
  if (!subject) return { mode: "all" };
  if (subject.kind === "suite") {
    // A stored run plan hands its own rule in. A test suite hands none,
    // because it covers the scenarios filed in it.
    return (
      subject.scope ?? { mode: "test_suites", testSuiteIds: [subject.suiteId] }
    );
  }
  if (subject.kind === "case") {
    return { mode: "scenarios", scenarioIds: [subject.scenarioId] };
  }
  // Run all and New run plan both start on everything; only New run plan can
  // then narrow it.
  return { mode: "all" };
}

/** True for the one entry point where the scope is still being chosen. */
export function picksScope(subject: RunDialogSubject | null): boolean {
  return subject?.kind === "plan";
}

/** The plan's own evaluators the subject opens on. */
function initialEvaluatorsOf(
  subject: RunDialogSubject | null,
): EvaluatorAttachment[] {
  if (subject?.kind !== "suite") return [];
  return subject.evaluators ?? [];
}

export function useRunPlanFields({
  subject,
  subjectKey,
}: {
  subject: RunDialogSubject | null;
  subjectKey: string;
}) {
  const [scope, setScope] = useState<RunScope>(() => initialScopeOf(subject));
  // The targets of a comparison. Empty outside compare mode: the run then
  // goes against the one agent the target section holds.
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [simulatorModel, setSimulatorModel] = useState<string | null>(null);
  const [judgeModel, setJudgeModel] = useState<string | null>(null);
  const [showRepeat, setShowRepeat] = useState(false);
  const [repeatCount, setRepeatCount] = useState(1);
  // The plan's own evaluators, beside the ones the suites in scope attach.
  const [evaluators, setEvaluators] = useState<EvaluatorAttachment[]>(() =>
    initialEvaluatorsOf(subject),
  );
  const [showEvaluators, setShowEvaluators] = useState(
    () => initialEvaluatorsOf(subject).length > 0,
  );

  useEffect(() => {
    setScope(initialScopeOf(subject));
    setCompareRows([]);
    setShowModels(false);
    setSimulatorModel(null);
    setJudgeModel(null);
    setShowRepeat(false);
    setRepeatCount(1);
    const initialEvaluators = initialEvaluatorsOf(subject);
    setEvaluators(initialEvaluators);
    setShowEvaluators(initialEvaluators.length > 0);
    // Reset exactly once per subject, as the rest of the dialog does.
  }, [subjectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    scope,
    setScope,
    isScopePicked: picksScope(subject),
    compareRows,
    setCompareRows,
    showCompare: compareRows.length > 0,
    showModels,
    setShowModels,
    simulatorModel,
    setSimulatorModel,
    judgeModel,
    setJudgeModel,
    showRepeat,
    setShowRepeat,
    repeatCount,
    setRepeatCount,
    evaluators,
    setEvaluators,
    showEvaluators,
    setShowEvaluators,
  };
}

export type RunPlanFields = ReturnType<typeof useRunPlanFields>;
