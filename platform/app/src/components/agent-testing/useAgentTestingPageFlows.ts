/**
 * The flows the Agent Testing page owns: the suite the address names, the
 * view state a shared link carries, and the two drawers that start work.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { useOpenNewRunPlan } from "./run/RunPlanDialogHost";
import type { AgentTestingSelection } from "./useAgentTestingRouting";
import { useAgentTestingStore } from "./useAgentTestingStore";

/** The id of the suite the address names, or nothing for any other selection. */
export function useSelectedSuiteTestSuiteId(
  selection: AgentTestingSelection,
): string | null {
  const { project } = useOrganizationTeamProject();

  // The rail reads the same list, so this is the cached copy rather than a
  // second read. It is only here to turn the address of a suite into its id.
  const { data: testSuites } = api.suites.testSuites.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  if (selection.kind !== "suite") return null;
  return (
    testSuites?.find((testSuite) => testSuite.slug === selection.slug)?.id ??
    null
  );
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

/**
 * New run plan opens the run dialog with the scope still to be chosen.
 *
 * A run plan is a name and a configuration, and the run dialog is the only
 * place either is chosen, so there is no separate editor to open.
 */
export function useNewRunPlanFlow(): () => void {
  return useOpenNewRunPlan();
}
