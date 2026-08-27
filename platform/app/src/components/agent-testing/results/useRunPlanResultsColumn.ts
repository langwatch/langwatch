/**
 * The wiring behind the results column: permissions, view mode, cancellation,
 * export and the run dialog, plus the header line for the selected run and
 * the settings that run was started with.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { format } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { useExportScenarioRuns } from "~/components/suites/useExportScenarioRuns";
import { useCan } from "~/hooks/useCan";
import { useNow } from "~/hooks/useNow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { PeriodControls } from "./period-controls";
import type { RunPlanDetailRun } from "./RunPlanDetailHeader";
import type { RunPlan } from "./run-plans";
import { type RunSettings, readRunSettings } from "./run-settings";
import type { RunPlanBatches, RunPlanSelection } from "./useRunPlanBatches";
import { useRunPlanCancel } from "./useRunPlanCancel";
import { useRunPlanRunDialog } from "./useRunPlanRunDialog";
import { useRunPlanViewMode } from "./useRunPlanViewMode";

export type RunPlanResultsColumnState = {
  canManage: boolean;
  viewMode: ReturnType<typeof useRunPlanViewMode>["viewMode"];
  onViewModeChange: ReturnType<
    typeof useRunPlanViewMode
  >["handleViewModeChange"];
  cancel: ReturnType<typeof useRunPlanCancel>;
  exportRuns: ReturnType<typeof useExportScenarioRuns>;
  isExportDisabled: boolean;
  /** The header line for the selected run, or nothing when none is selected. */
  run: RunPlanDetailRun | null;
  /** What the selected run was configured with, once there is one to read. */
  runSettings: RunSettings | null;
  /** When the selected run started, as the settings block prints it. */
  runStartedLabel: string | null;
  isRunSettingsShown: boolean;
  toggleRunSettings: () => void;
  runDialog: ReturnType<typeof useRunPlanRunDialog>;
};

export function useRunPlanResultsColumn({
  plan,
  batches,
  selection,
  periodControls,
}: {
  plan: RunPlan;
  batches: RunPlanBatches;
  selection: RunPlanSelection;
  periodControls: PeriodControls;
}): RunPlanResultsColumnState {
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const now = useNow();
  const canManage = can("scenarios:manage");
  const { viewMode, handleViewModeChange } = useRunPlanViewMode();
  const runDialog = useRunPlanRunDialog({ plan, canManage });
  const [isRunSettingsShown, setRunSettingsShown] = useState(false);
  const toggleRunSettings = useCallback(
    () => setRunSettingsShown((shown) => !shown),
    [],
  );

  const runSettings = useMemo(
    () => readRunSettings(selection.selectedBatch?.scenarioRuns ?? []),
    [selection.selectedBatch],
  );

  // The date as well as the age: the runs rail already says "2h ago", and a
  // person reading the settings of an old run wants the day it ran.
  const startedAt = selection.selectedBatch?.timestamp ?? null;
  const runStartedLabel =
    startedAt === null
      ? null
      : `${format(new Date(startedAt), "d MMM yyyy, HH:mm")} · ${formatTimeAgoCompact(startedAt, now)}`;

  const cancel = useRunPlanCancel({
    scenarioSetId: plan.scenarioSetId,
    selectedBatchRunId: selection.selectedBatch?.batchRunId ?? null,
    refetch: batches.refetch,
  });

  const exportRuns = useExportScenarioRuns({
    projectId: project?.id,
    scenarioSetId: plan.scenarioSetId,
    startDate: periodControls.period.startDate.getTime(),
    endDate: periodControls.period.endDate.getTime(),
  });

  return {
    canManage,
    viewMode,
    onViewModeChange: handleViewModeChange,
    cancel,
    exportRuns,
    isExportDisabled:
      batches.isLoading ||
      exportRuns.isExporting ||
      batches.batchRuns.length === 0,
    run: selection.selectedBatch
      ? {
          title: selection.title ?? "",
          note: selection.note,
          summary: selection.summary,
        }
      : null,
    runSettings,
    runStartedLabel,
    isRunSettingsShown,
    toggleRunSettings,
    runDialog,
  };
}
