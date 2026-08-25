/**
 * The flows the Agent Testing page owns: the suite the address names, the
 * view state a shared link carries, and the two drawers that start work.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useCallback, useEffect } from "react";
import type { SimulationSuite } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { useOpenLiveRun } from "./cases/useOpenLiveRun";
import type { AgentTestingSelection } from "./useAgentTestingRouting";
import { useAgentTestingStore } from "./useAgentTestingStore";

/** The id of the suite the address names, or nothing for any other selection. */
export function useSelectedSuiteFolderId(
  selection: AgentTestingSelection,
): string | null {
  const { project } = useOrganizationTeamProject();

  // The rail reads the same list, so this is the cached copy rather than a
  // second read. It is only here to turn the address of a suite into its id.
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  if (selection.kind !== "suite") return null;
  return folders?.find((folder) => folder.slug === selection.slug)?.id ?? null;
}

/**
 * The view mode is the one piece of view state the address carries, so a
 * shared link opens the results the way they were shared.
 */
export function useHydrateViewFromUrl(): void {
  const router = useRouter();
  const hydrateFromUrl = useAgentTestingStore((state) => state.hydrateFromUrl);
  const viewParam = router.query.view;

  useEffect(() => {
    if (!router.isReady) return;
    hydrateFromUrl(router.query);
  }, [router.isReady, viewParam, hydrateFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Opens the run plan editor, and lands on the plan it saved. */
export function useNewRunPlanFlow(
  selectPlan: (planSlug: string | null) => void,
): () => void {
  const { openDrawer, setFlowCallbacks } = useDrawer();

  const handleSuiteSaved = useCallback(
    (suite: SimulationSuite) => {
      selectPlan(suite.slug);
    },
    [selectPlan],
  );

  return useCallback(() => {
    setFlowCallbacks("suiteEditor", { onSaved: handleSuiteSaved });
    openDrawer("suiteEditor");
  }, [openDrawer, setFlowCallbacks, handleSuiteSaved]);
}

/**
 * Save and Run inside the case editor keeps the person on this page. The run
 * opens in the drawer instead of sending them to the v1 page.
 */
export function useScenarioEditorRunFlow(projectId: string | undefined): void {
  const { setFlowCallbacks } = useDrawer();
  const { openLiveRun } = useOpenLiveRun();
  const setPendingBatchRunId = useAgentTestingStore(
    (state) => state.setPendingBatchRunId,
  );

  useEffect(() => {
    if (!projectId) return;
    setFlowCallbacks("scenarioEditor", {
      onRunStarted: ({ batchRunId }: { batchRunId: string }) => {
        setPendingBatchRunId(batchRunId);
        void openLiveRun({
          batchRunId,
          scenarioSetId: getOnPlatformSetId(projectId),
        });
      },
    });
  }, [projectId, setFlowCallbacks, setPendingBatchRunId, openLiveRun]);
}
