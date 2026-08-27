/**
 * The fields of the run dialog that describe the run itself rather than the
 * agent: what it covers, the second agent it compares against, the simulation
 * models, and how many times it repeats.
 *
 * They reset once per subject, the same way the rest of the dialog does.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useEffect, useState } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import type { RunScope } from "./run-configuration";
import type { RunDialogSubject } from "./run-dialog-types";

/** What the entry point already decided the run covers. */
export function initialScopeOf(subject: RunDialogSubject | null): RunScope {
  if (!subject) return { mode: "all" };
  if (subject.kind === "suite") {
    return { mode: "folders", folderIds: [subject.suiteId] };
  }
  if (subject.kind === "case") {
    return { mode: "cases", caseIds: [subject.scenarioId] };
  }
  // Run all and New run plan both start on everything; only New run plan can
  // then narrow it.
  return { mode: "all" };
}

/** True for the one entry point where the scope is still being chosen. */
export function picksScope(subject: RunDialogSubject | null): boolean {
  return subject?.kind === "plan";
}

export function useRunPlanFields({
  subject,
  subjectKey,
}: {
  subject: RunDialogSubject | null;
  subjectKey: string;
}) {
  const [scope, setScope] = useState<RunScope>(() => initialScopeOf(subject));
  const [showCompare, setShowCompare] = useState(false);
  const [compareTarget, setCompareTarget] = useState<TargetValue>(null);
  const [showModels, setShowModels] = useState(false);
  const [simulatorModel, setSimulatorModel] = useState<string | null>(null);
  const [judgeModel, setJudgeModel] = useState<string | null>(null);
  const [showRepeat, setShowRepeat] = useState(false);
  const [repeatCount, setRepeatCount] = useState(1);

  useEffect(() => {
    setScope(initialScopeOf(subject));
    setShowCompare(false);
    setCompareTarget(null);
    setShowModels(false);
    setSimulatorModel(null);
    setJudgeModel(null);
    setShowRepeat(false);
    setRepeatCount(1);
    // Reset exactly once per subject, as the rest of the dialog does.
  }, [subjectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    scope,
    setScope,
    isScopePicked: picksScope(subject),
    showCompare,
    setShowCompare,
    compareTarget,
    setCompareTarget,
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
  };
}

export type RunPlanFields = ReturnType<typeof useRunPlanFields>;
