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
import type { RunActor } from "~/server/scenarios/run-actor";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { PeriodControls } from "./period-controls";
import type { RunPlanDetailRun } from "./RunPlanDetailHeader";
import type { RunPlan } from "./run-plans";
import {
  type RunSettings,
  readRunSettings,
  runActorName,
} from "./run-settings";
import {
  type BatchTarget,
  isComparison,
  useBatchTargets,
} from "./useBatchTargets";
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
  /**
   * Who started the selected run, in the words this reader knows them by, or
   * nothing when the run recorded no person.
   */
  runStartedByLabel: string | null;
  isRunSettingsShown: boolean;
  toggleRunSettings: () => void;
  runDialog: ReturnType<typeof useRunPlanRunDialog>;
  /** The targets of the selected run, in order and in colour. */
  targets: BatchTarget[];
};

/** One stable empty list, so a plan with no run selected keeps its identity. */
const NO_RUNS: ScenarioRunData[] = [];

/**
 * What the settings row calls whoever started a run.
 *
 * The roster is asked for only when a name is actually wanted: a run the
 * reader started, one started through a key, and one with no person behind it
 * all name themselves. The query is the one the other non-admin member
 * pickers read, so the roster is usually already in cache.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
function useRunStartedByLabel(actor: RunActor | null): string | null {
  const { organization } = useOrganizationTeamProject();
  // The reader's own id, which is what lets a run they started read as "You".
  // Read without requiring a session: the page is already behind the sign-in
  // gate, and a redirect does not belong to this hook.
  const { data: session } = useSession();
  const viewerUserId = session?.user?.id;
  const needsMemberName =
    actor?.label === "user" && !!actor.id && actor.id !== viewerUserId;

  const members =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organization?.id ?? "" },
      { enabled: !!organization?.id && needsMemberName },
    );

  // Members whose row carries no name are left out, so an empty name can
  // never reach the row as an empty label.
  const memberNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const member of members.data?.members ?? []) {
      const name = member.user.name?.trim();
      if (name) byId.set(member.user.id, name);
    }
    return byId;
  }, [members.data]);

  return runActorName({ actor, viewerUserId, memberNameById });
}

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

  const selectedRuns = selection.selectedBatch?.scenarioRuns ?? NO_RUNS;
  const runSettings = useMemo(
    () => readRunSettings(selectedRuns),
    [selectedRuns],
  );
  const targets = useBatchTargets(selectedRuns);

  // The date as well as the age: the runs rail already says "2h ago", and a
  // person reading the settings of an old run wants the day it ran.
  const startedAt = selection.selectedBatch?.timestamp ?? null;
  const runStartedLabel =
    startedAt === null
      ? null
      : `${format(new Date(startedAt), "d MMM yyyy, HH:mm")} · ${formatTimeAgoCompact(startedAt, now)}`;

  const runStartedByLabel = useRunStartedByLabel(runSettings?.actor ?? null);

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
          // A comparison carries no summary of the whole run: one number over
          // two targets says nothing about either, and each column carries
          // its own.
          summary: isComparison(targets) ? null : selection.summary,
        }
      : null,
    runSettings,
    runStartedLabel,
    runStartedByLabel,
    isRunSettingsShown,
    toggleRunSettings,
    runDialog,
    targets,
  };
}
