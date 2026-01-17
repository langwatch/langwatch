import { useRouter } from "next/router";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { captureException } from "../../utils/posthogErrorCapture";
import { isNotFound as isTrpcNotFound } from "../../utils/trpcError";
import { createInitialState } from "../types";
import { extractPersistedState } from "../types/persistence";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

const AUTOSAVE_DEBOUNCE_MS = 1500; // Wait 1.5s after last change before saving

const stringifiedInitialState = JSON.stringify(
  extractPersistedState(createInitialState()),
);

/**
 * Manages syncing the evaluations v3 state with the database.
 * Uses workbenchState field in the Experiment model for persistence.
 *
 * This hook expects the experiment to already exist - it only loads and saves.
 * New experiments are created by the index page before redirecting here.
 */
export const useAutosaveEvaluationsV3 = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which slug we've successfully loaded in THIS component instance
  // This prevents re-loading on every render while allowing reload after navigation
  const loadedSlugRef = useRef<string | null>(null);

  const {
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    targets,
    results,
    hiddenColumns,
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
      targets: state.targets,
      results: state.results,
      hiddenColumns: state.ui.hiddenColumns,
      setExperimentId: state.setExperimentId,
      setExperimentSlug: state.setExperimentSlug,
      setName: state.setName,
      setAutosaveStatus: state.setAutosaveStatus,
      loadState: state.loadState,
    })),
  );

  const persistedState = extractPersistedState({
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    targets,
    results,
    pendingSavedChanges: {},
    ui: {
      selectedRows: new Set(),
      columnWidths: {},
      rowHeightMode: "compact",
      expandedCells: new Set(),
      hiddenColumns,
      autosaveStatus: { evaluation: "idle", dataset: "idle" },
      concurrency: 10,
    },
  });

  const stringifiedState = JSON.stringify(persistedState);

  const saveExperiment = api.experiments.saveEvaluationsV3.useMutation();

  const routerSlug = router.query.slug as string | undefined;

  // Detect if the store was reset while component stayed mounted
  // This happens when user navigates away and back - reset() is called but component might not remount
  // If we previously loaded this slug but experimentSlug is now different (or undefined), reset the ref
  if (loadedSlugRef.current === routerSlug && experimentSlug !== routerSlug) {
    loadedSlugRef.current = null;
  }

  // Determine if we need to load the experiment from the database.
  // We should load if:
  // 1. We have a project and a slug in the URL
  // 2. The store's experimentSlug doesn't match the URL slug
  //    (this means either: new page, store was reset, or navigated to different experiment)
  // 3. We haven't already loaded this slug in this component instance
  //    (prevents duplicate loads during the same mount)
  const shouldLoadExisting =
    !!project &&
    !!routerSlug &&
    experimentSlug !== routerSlug &&
    loadedSlugRef.current !== routerSlug;

  // Load existing experiment if navigating to one
  const existingExperiment = api.experiments.getEvaluationsV3BySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: routerSlug ?? "",
    },
    { enabled: shouldLoadExisting },
  );

  // Update URL when experiment slug changes (for URL sync after save)
  useEffect(() => {
    if (project && experimentSlug && routerSlug !== experimentSlug) {
      void router.replace(
        `/${project.slug}/evaluations/v3/${experimentSlug}`,
        undefined,
        { shallow: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, project?.slug]);

  // Load existing experiment data into store
  useEffect(() => {
    if (existingExperiment.data && loadedSlugRef.current !== routerSlug) {
      // Mark this slug as loaded BEFORE updating store to prevent race conditions
      loadedSlugRef.current = routerSlug ?? null;

      // Set experiment ID and slug first
      setExperimentId(existingExperiment.data.id);
      setExperimentSlug(existingExperiment.data.slug);

      // Load the full wizard state if available
      if (existingExperiment.data.workbenchState && loadState) {
        loadState(existingExperiment.data.workbenchState);
      }
    }
  }, [
    existingExperiment.data,
    routerSlug,
    setExperimentId,
    setExperimentSlug,
    loadState,
  ]);

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
    // Don't save while we're loading an existing experiment
    if (existingExperiment.isLoading) return;
    // CRITICAL: Don't save if we should be loading (store doesn't match URL)
    // This prevents saving blank/stale data when navigating back
    if (shouldLoadExisting) return;
    // Don't save if we don't have an experiment ID yet (experiment must exist first)
    if (!experimentId) return;
    if (!name) return;

    // Only save if there are actual changes from initial state
    if (stringifiedState === stringifiedInitialState) {
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
            state: persistedState as Parameters<
              typeof saveExperiment.mutateAsync
            >[0]["state"],
          });

          setExperimentId(updatedExperiment.id);
          setExperimentSlug(updatedExperiment.slug);
          if (updatedExperiment.name && updatedExperiment.name !== name) {
            setName(updatedExperiment.name);
          }
          markSaved();
        } catch (error) {
          console.error("Failed to autosave evaluations v3:", error);
          setAutosaveStatus(
            "evaluation",
            "error",
            error instanceof Error ? error.message : "Unknown error",
          );
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
  }, [
    stringifiedState,
    project?.id,
    shouldLoadExisting,
    experimentId,
    existingExperiment.isLoading,
  ]);

  // Determine if experiment was truly not found
  // Check if the error is a NOT_FOUND error (using multiple checks for robustness)
  const isNotFoundError =
    isTrpcNotFound(existingExperiment.error) ||
    existingExperiment.error?.data?.code === "NOT_FOUND" ||
    existingExperiment.error?.data?.httpStatus === 404;

  // isNotFound: query completed with error AND that error is NOT_FOUND
  const isNotFound = existingExperiment.isError && isNotFoundError;

  return {
    isLoading: existingExperiment.isLoading,
    isSaving: saveExperiment.isPending,
    existingExperiment: existingExperiment.data,
    isNotFound,
    // Only show isError for non-NOT_FOUND errors (e.g., permission denied)
    isError: existingExperiment.isError && !isNotFoundError,
    error: existingExperiment.error,
  };
};
