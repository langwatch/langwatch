import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { toaster } from "../../components/ui/toaster";
import { captureException } from "../../utils/posthogErrorCapture";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import { createInitialState } from "../types";
import { extractPersistedState } from "../types/persistence";

const stringifiedInitialState = JSON.stringify(
  extractPersistedState(createInitialState())
);

/**
 * Manages syncing the evaluations v3 state with the database.
 * Uses wizardState field in the Experiment model for persistence.
 */
export const useAutosaveEvaluationsV3 = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const lastAutosaveRef = useRef(0);

  const {
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    agents,
    setExperimentId,
    setExperimentSlug,
    setName,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      agents: state.agents,
      setExperimentId: state.setExperimentId,
      setExperimentSlug: state.setExperimentSlug,
      setName: state.setName,
    }))
  );

  const persistedState = extractPersistedState({
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    agents,
    results: {
      status: "idle",
      agentOutputs: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: { selectedRows: new Set(), columnWidths: {}, rowHeightMode: "compact", expandedCells: new Set() },
  });

  const stringifiedState = JSON.stringify(persistedState);

  const saveExperiment = api.experiments.saveEvaluationsV3.useMutation();

  const routerSlug = router.query.slug as string | undefined;

  // Load existing experiment if navigating to one
  const existingExperiment = api.experiments.getEvaluationsV3BySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: routerSlug ?? "",
    },
    { enabled: !!project && !!routerSlug && !experimentSlug }
  );

  // Update URL when experiment slug changes
  useEffect(() => {
    if (project && experimentSlug && routerSlug !== experimentSlug) {
      void router.replace(
        `/${project.slug}/evaluations-v3/${experimentSlug}`,
        undefined,
        { shallow: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, project?.slug]);

  // Load existing experiment data into store
  useEffect(() => {
    if (existingExperiment.data?.wizardState) {
      const loadedState = existingExperiment.data.wizardState;
      // The store actions will be used to set the loaded state
      // This is handled by the parent component/page
    }
  }, [existingExperiment.data]);

  // Autosave effect
  useEffect(() => {
    if (!project) return;
    if ((!!experimentSlug || !!routerSlug) && !existingExperiment.data && existingExperiment.isLoading) return;
    if (!name) return;

    const now = Date.now();
    if (now - lastAutosaveRef.current < 100) return;
    lastAutosaveRef.current = now;

    // Only save if there are actual changes from initial state
    if (
      !!existingExperiment.data?.id ||
      stringifiedState !== stringifiedInitialState
    ) {
      void (async () => {
        try {
          const updatedExperiment = await saveExperiment.mutateAsync({
            projectId: project.id,
            experimentId: experimentId ?? existingExperiment.data?.id,
            // Cast to any since the actual types are more complex than the schema
            // The schema is designed to be lenient for storage
            state: persistedState as Parameters<typeof saveExperiment.mutateAsync>[0]["state"],
          });

          setExperimentId(updatedExperiment.id);
          setExperimentSlug(updatedExperiment.slug);
          if (updatedExperiment.name && updatedExperiment.name !== name) {
            setName(updatedExperiment.name);
          }
        } catch (error) {
          console.error("Failed to autosave evaluations v3:", error);
          toaster.create({
            title: "Failed to autosave evaluation",
            type: "error",
            meta: {
              closable: true,
            },
          });
          captureException(error, {
            extra: {
              context: "Failed to autosave evaluations v3",
              projectId: project.id,
              persistedState,
            },
          });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stringifiedState]);

  return {
    isLoading: existingExperiment.isLoading,
    isSaving: saveExperiment.isPending,
    existingExperiment: existingExperiment.data,
  };
};
