/**
 * The run dialog of the Results tab: Run on an open run plan, and Rerun on one
 * result row.
 *
 * The plan is run as its test suite, so the dialog offers the same targets and
 * the same remembered choice as running it from the rail. A single row runs the
 * one case it holds, which is an ordinary run plan of that case and its agent.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import { useCallback, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { readScenarioTarget } from "~/hooks/useScenarioTarget";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import { useRunStartedHandler } from "../cases/useCaseRunActions";
import { storedPlanSubject } from "../run/plan-scope";
import type { RunDialogSubject } from "../run/RunDialog";
import type { RunPlan } from "./run-plans";

export type RunPlanRunDialog = {
  subject: RunDialogSubject | null;
  close: () => void;
  onRunStarted: ReturnType<typeof useRunStartedHandler>;
  /** Opens the dialog on the whole plan, or nothing when it cannot be run. */
  runPlan?: () => void;
  /** Opens the dialog on the one case a result row ran. */
  rerunCase: (scenarioRun: ScenarioRunData) => void;
};

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
  const { data: suite } = api.suites.getById.useQuery(
    { projectId, id: suiteId ?? "" },
    { enabled: !!projectId && !!suiteId && canManage },
  );

  const runPlan = useCallback(() => {
    if (!suite) return;
    setSubject(storedPlanSubject(suite));
  }, [suite]);

  const rerunCase = useCallback(
    (scenarioRun: ScenarioRunData) => {
      setSubject({
        kind: "case",
        scenarioId: scenarioRun.scenarioId,
        name: scenarioRun.name ?? scenarioRun.scenarioId,
        initialTarget: readScenarioTarget({
          projectId,
          scenarioId: scenarioRun.scenarioId,
        }),
      });
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
