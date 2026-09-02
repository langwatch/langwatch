/**
 * The flows the Agent Testing page owns: the suite the address names, the
 * view state a shared link carries, and the two drawers that start work.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useCallback, useEffect } from "react";
import { getOnPlatformSetId } from "@langwatch/scenario-contract";
import type { SimulationSuite } from "../../model/prisma-types";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api } from "../../behavior/scenario-api";
import { useRouter } from "../../behavior/next-router";
import { useOpenLiveRun } from "./cases/useOpenLiveRun";
import { PLAN_EDITOR_DRAWER } from "./plan/usePlanEditor";
import type { AgentTestingSelection } from "./useAgentTestingRouting";
import { useAgentTestingStore } from "./useAgentTestingStore";

/** The id of the suite the address names, or nothing for any other selection. */
export function useSelectedSuiteFolderId(selection: AgentTestingSelection): string | null {
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
export function useNewRunPlanFlow(selectPlan: (planSlug: string | null) => void): () => void {
  const { openDrawer, setFlowCallbacks } = useDrawer();

  const handleSuiteSaved = useCallback(
    (suite: SimulationSuite) => {
      selectPlan(suite.slug);
    },
    [selectPlan],
  );

  return useCallback(() => {
    setFlowCallbacks(PLAN_EDITOR_DRAWER, { onSaved: handleSuiteSaved });
    openDrawer(PLAN_EDITOR_DRAWER);
  }, [openDrawer, setFlowCallbacks, handleSuiteSaved]);
}

/**
 * Save and Run inside the case editor keeps the person on this page. The run
 * opens in the drawer instead of sending them to the v1 page.
 */
export function useScenarioEditorRunFlow(projectId: string | undefined): void {
  const { setFlowCallbacks } = useDrawer();
  const { openLiveRun } = useOpenLiveRun();
  const setPendingRun = useAgentTestingStore((state) => state.setPendingRun);

  useEffect(() => {
    if (!projectId) return;
    const scenarioSetId = getOnPlatformSetId(projectId);
    setFlowCallbacks("scenarioEditor", {
      onRunStarted: ({ batchRunId }: { batchRunId: string }) => {
        setPendingRun({ batchRunId, scenarioSetId });
        void openLiveRun({ batchRunId, scenarioSetId });
      },
    });
    return () => setFlowCallbacks("scenarioEditor", {});
  }, [projectId, setFlowCallbacks, setPendingRun, openLiveRun]);
}
