/**
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { useCallback, useState } from "react";

import type { RunPlan } from "../../../../behavior/agent-testing/results/run-plans.ts";
import { useSuite } from "../../../../behavior/suites/use-suite.ts";
import { readScenarioTarget } from "../../use-scenario-target.ts";
import { useRunStartedHandler } from "../cases/use-case-run-actions.ts";
import { storedPlanSubject } from "../run/plan-scope.ts";
import type { RunDialogSubject } from "../run/run-dialog.tsx";

export type RunPlanRunDialog = {
  subject: RunDialogSubject | null;
  close: () => void;
  onRunStarted: ReturnType<typeof useRunStartedHandler>;
  /** Opens the dialog on the whole plan, or nothing when it cannot be run. */
  runPlan?: () => void;
  /** Opens the dialog on the one case a result row ran. */
  rerunCase: (scenarioRun: ScenarioRunData) => void;
};

type RunAgainSource = Pick<ScenarioRunData, "scenarioId" | "name" | "metadata">;

/** Why a run pushed from code offers Run again disabled. */
export const RUN_AGAIN_FROM_CODE_REASON =
  "This run came from code, so the platform cannot run it again. Rerun it from your test suite.";

/** True when the platform launched the run, so it holds the scenario and target. */
export function canRunAgain({ scenarioRun }: { scenarioRun: RunAgainSource }): boolean {
  return !!scenarioRun.metadata?.langwatch;
}

/**
 * The run dialog subject for running one scenario again, preselecting the
 * target the run used and falling back to the one last chosen for the scenario.
 */
export function runAgainSubjectOf({
  scenarioRun,
  projectId,
}: {
  scenarioRun: RunAgainSource;
  projectId: string;
}): RunDialogSubject {
  const langwatch = scenarioRun.metadata?.langwatch;
  return {
    kind: "case",
    scenarioId: scenarioRun.scenarioId,
    name: scenarioRun.name ?? scenarioRun.scenarioId,
    initialTarget: langwatch
      ? { type: langwatch.targetType, id: langwatch.targetReferenceId }
      : readScenarioTarget({ projectId, scenarioId: scenarioRun.scenarioId }),
  };
}

export function useRunPlanRunDialog({
  plan,
  canManage,
}: {
  plan: RunPlan;
  canManage: boolean;
}): RunPlanRunDialog {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const [subject, setSubject] = useState<RunDialogSubject | null>(null);
  const onRunStarted = useRunStartedHandler();

  const suiteId = plan.kind === "suite" ? plan.suiteId : null;
  const { data: suite } = useSuite({
    projectId,
    id: suiteId ?? undefined,
    enabled: canManage,
  });

  const runPlan = useCallback(() => {
    if (!suite) return;
    setSubject(storedPlanSubject(suite));
  }, [suite]);

  const rerunCase = useCallback(
    (scenarioRun: ScenarioRunData) => {
      setSubject(runAgainSubjectOf({ scenarioRun, projectId }));
    },
    [projectId],
  );

  return {
    subject,
    close: () => setSubject(null),
    onRunStarted,
    runPlan: suiteId && suite ? runPlan : undefined,
    rerunCase,
  };
}
