import { useRouter } from "next/router";
import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { toaster } from "../../components/ui/toaster";
import { captureException } from "../../utils/posthogErrorCapture";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import { createInitialState } from "../types";
import { extractPersistedState } from "../types/persistence";

const AUTOSAVE_DEBOUNCE_MS = 1500; // Wait 1.5s after last change before saving

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
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedExistingRef = useRef(false);

  const {
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    runners,
    setExperimentId,
    setExperimentSlug,
    setName,
    setAutosaveStatus,
    loadState,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      runners: state.runners,
      setExperimentId: state.setExperimentId,
      setExperimentSlug: state.setExperimentSlug,
      setName: state.setName,
      setAutosaveStatus: state.setAutosaveStatus,
      loadState: state.loadState,
    }))
  );

  const persistedState = extractPersistedState({
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    runners,
    results: {
      status: "idle",
      runnerOutputs: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: {
      selectedRows: new Set(),
      columnWidths: {},
      rowHeightMode: "compact",
      expandedCells: new Set(),
      hiddenColumns: new Set(),
      autosaveStatus: { evaluation: "idle", dataset: "idle" },
    },
  });

  const stringifiedState = JSON.stringify(persistedState);

  const saveExperiment = api.experiments.saveEvaluationsV3.useMutation();

  const routerSlug = router.query.slug as string | undefined;

  // Only try to load existing experiment if we don't already have an experimentId loaded
  const shouldLoadExisting = !!project && !!routerSlug && !experimentId && !hasLoadedExistingRef.current;

  // Load existing experiment if navigating to one
  const existingExperiment = api.experiments.getEvaluationsV3BySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: routerSlug ?? "",
    },
    { enabled: shouldLoadExisting }
  );

  // Update URL when experiment slug changes
  useEffect(() => {
    if (project && experimentSlug && routerSlug !== experimentSlug) {
      void router.replace(
        `/${project.slug}/evaluations/v3/${experimentSlug}`,
        undefined,
        { shallow: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, project?.slug]);

  // Load existing experiment data into store OR set slug from URL for new experiments
  useEffect(() => {
    if (existingExperiment.data && !hasLoadedExistingRef.current) {
      hasLoadedExistingRef.current = true;

      // Set experiment ID and slug first
      setExperimentId(existingExperiment.data.id);
      setExperimentSlug(existingExperiment.data.slug);

      // Load the full wizard state if available
      if (existingExperiment.data.wizardState && loadState) {
        loadState(existingExperiment.data.wizardState);
      }
    } else if (
      !existingExperiment.isLoading &&
      !existingExperiment.data &&
      routerSlug &&
      !hasLoadedExistingRef.current &&
      !experimentSlug
    ) {
      // No existing experiment found - this is a new one
      // Set the slug from the URL so it's included in the first save
      hasLoadedExistingRef.current = true;
      setExperimentSlug(routerSlug);
    }
  }, [existingExperiment.data, existingExperiment.isLoading, routerSlug, experimentSlug, setExperimentId, setExperimentSlug, loadState]);

  // Clear timeouts on unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Transition to "saved" then back to "idle" after delay
  const markSaved = useCallback(() => {
    setAutosaveStatus("evaluation", "saved");
    if (savedTimeoutRef.current) {
      clearTimeout(savedTimeoutRef.current);
    }
    savedTimeoutRef.current = setTimeout(() => {
      setAutosaveStatus("evaluation", "idle");
    }, 2000);
  }, [setAutosaveStatus]);

  // Autosave effect with debounce
  useEffect(() => {
    if (!project) return;
    // Only wait if we're actually trying to load an existing experiment
    if (shouldLoadExisting && existingExperiment.isLoading) return;
    // Don't save while we're loading an existing experiment
    if (existingExperiment.isLoading) return;
    if (!name) return;

    // Only save if we have an existing experiment OR there are actual changes from initial state
    if (!experimentId && stringifiedState === stringifiedInitialState) {
      return;
    }

    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set debounced save - waits until user stops making changes
    debounceTimeoutRef.current = setTimeout(() => {
      setAutosaveStatus("evaluation", "saving");

      void (async () => {
        try {
          const updatedExperiment = await saveExperiment.mutateAsync({
            projectId: project.id,
            experimentId: experimentId,
            // Cast to any since the actual types are more complex than the schema
            // The schema is designed to be lenient for storage
            state: persistedState as Parameters<typeof saveExperiment.mutateAsync>[0]["state"],
          });

          setExperimentId(updatedExperiment.id);
          setExperimentSlug(updatedExperiment.slug);
          if (updatedExperiment.name && updatedExperiment.name !== name) {
            setName(updatedExperiment.name);
          }
          markSaved();
        } catch (error) {
          console.error("Failed to autosave evaluations v3:", error);
          setAutosaveStatus("evaluation", "error", error instanceof Error ? error.message : "Unknown error");
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
    }, AUTOSAVE_DEBOUNCE_MS);

    // Cleanup on dependency change
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stringifiedState, project?.id, shouldLoadExisting, experimentId, existingExperiment.isLoading]);

  return {
    isLoading: existingExperiment.isLoading,
    isSaving: saveExperiment.isPending,
    existingExperiment: existingExperiment.data,
  };
};
