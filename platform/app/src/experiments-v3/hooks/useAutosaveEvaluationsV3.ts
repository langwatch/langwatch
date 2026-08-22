import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { readHandledError } from "~/features/errors/logic/readHandledError";
import { useRouter } from "~/utils/compat/next-router";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { captureException, toError } from "../../utils/posthogErrorCapture";
import { isNotFound as isTrpcNotFound } from "../../utils/trpcError";
import { createInitialState } from "../types";
import { extractPersistedState } from "../types/persistence";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

const AUTOSAVE_DEBOUNCE_MS = 1500; // Wait 1.5s after last change before saving

const stringifiedInitialState = JSON.stringify(
  extractPersistedState(createInitialState()),
);

/**
 * The persisted projection of the store as it is RIGHT NOW, read outside the
 * render cycle. The load paths use it to record the saved baseline in the same
 * effect that loads the state: a render-scope string from the same commit
 * still describes the pre-load state, and capturing that made every page load
 * look dirty and autosave a no-op change.
 */
const stringifyPersistedSnapshot = (): string => {
  const s = useEvaluationsV3Store.getState();
  return JSON.stringify(
    extractPersistedState({
      experimentId: s.experimentId,
      experimentSlug: s.experimentSlug,
      name: s.name,
      datasets: s.datasets,
      activeDatasetId: s.activeDatasetId,
      evaluators: s.evaluators,
      targets: s.targets,
      results: s.results,
      pendingSavedChanges: {},
      ui: {
        selectedRows: new Set(),
        columnWidths: {},
        rowHeightMode: "compact",
        expandedCells: new Set(),
        hiddenColumns: s.ui.hiddenColumns,
        autosaveStatus: { evaluation: "idle", dataset: "idle" },
        concurrency: s.ui.concurrency,
        hasRunThisSession: false,
      },
    }),
  );
};

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
  const queryClient = useQueryClient();
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which slug we've successfully loaded in THIS component instance
  // This prevents re-loading on every render while allowing reload after navigation
  const loadedSlugRef = useRef<string | null>(null);

  const {
    experimentId,
    experimentSlug,
    workbenchVersion,
    staleWorkbench,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    targets,
    results,
    hiddenColumns,
    concurrency,
    setExperimentId,
    setExperimentSlug,
    setWorkbenchVersion,
    setStaleWorkbench,
    setName,
    setAutosaveStatus,
    loadState,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
      workbenchVersion: state.workbenchVersion,
      staleWorkbench: state.staleWorkbench,
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      targets: state.targets,
      results: state.results,
      hiddenColumns: state.ui.hiddenColumns,
      concurrency: state.ui.concurrency,
      setExperimentId: state.setExperimentId,
      setExperimentSlug: state.setExperimentSlug,
      setWorkbenchVersion: state.setWorkbenchVersion,
      setStaleWorkbench: state.setStaleWorkbench,
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
      concurrency,
      hasRunThisSession: false,
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
        `/${project.slug}/experiments/workbench/${experimentSlug}`,
        undefined,
        { shallow: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, project?.slug]);

  // What the server last acknowledged, as the exact string this hook would
  // send. `stringifiedState !== lastSavedRef.current` is the ONE definition of
  // a dirty workbench; the update listener reads it through `isDirty` below.
  const lastSavedRef = useRef<string | null>(null);
  const justLoadedRef = useRef(false);

  // Load existing experiment data into store
  useEffect(() => {
    if (existingExperiment.data && loadedSlugRef.current !== routerSlug) {
      // Mark this slug as loaded BEFORE updating store to prevent race conditions
      loadedSlugRef.current = routerSlug ?? null;

      // Set experiment ID and slug first
      setExperimentId(existingExperiment.data.id);
      setExperimentSlug(existingExperiment.data.slug);
      setWorkbenchVersion(existingExperiment.data.version);
      setStaleWorkbench(undefined);

      // Load the full wizard state if available
      if (existingExperiment.data.workbenchState && loadState) {
        loadState(existingExperiment.data.workbenchState);
      }
      // The store now holds the saved state: record its projection as the
      // baseline, and skip the autosave pass that runs in this same commit
      // (its render-scope string still describes the pre-load state).
      lastSavedRef.current = stringifyPersistedSnapshot();
      justLoadedRef.current = true;
    }
  }, [
    existingExperiment.data,
    routerSlug,
    setExperimentId,
    setExperimentSlug,
    setWorkbenchVersion,
    setStaleWorkbench,
    loadState,
  ]);

  // Clear timeouts and invalidate query cache on unmount
  // Invalidating the cache ensures that when user navigates back,
  // fresh data is fetched from DB instead of returning stale cached data
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      // Invalidate the query cache for this experiment so that when
      // user navigates back, it fetches fresh data instead of stale cache
      if (routerSlug) {
        // Use a predicate to match the query key pattern for tRPC queries
        // tRPC query keys are arrays like [["experiments", "getEvaluationsV3BySlug"], { input: {...}, type: "query" }]
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            if (!Array.isArray(key) || key.length < 2) return false;
            const [path] = key;
            if (!Array.isArray(path)) return false;
            return (
              path[0] === "experiments" && path[1] === "getEvaluationsV3BySlug"
            );
          },
        });
      }
    };
  }, [queryClient, routerSlug]);

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
    // The pass that runs in the same commit as a load still sees the
    // pre-load string; the load effect already recorded the real baseline.
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      return;
    }
    if (!project) return;
    // Don't save while we're loading an existing experiment
    if (existingExperiment.isLoading) return;
    // CRITICAL: Don't save if we should be loading (store doesn't match URL)
    // This prevents saving blank/stale data when navigating back
    if (shouldLoadExisting) return;
    // Don't save if we don't have an experiment ID yet (experiment must exist first)
    if (!experimentId) return;
    if (!name) return;
    // Out of date against the server: saving now would clobber the newer
    // version, so autosave stands down until the user reloads.
    if (staleWorkbench) return;

    // Only save if there are actual changes from initial state
    if (stringifiedState === stringifiedInitialState) {
      return;
    }
    // Nothing changed since the last acknowledged save.
    if (stringifiedState === lastSavedRef.current) {
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
            expectedVersion: workbenchVersion,
            // Cast to any since the actual types are more complex than the schema
            // The schema is designed to be lenient for storage
            state: persistedState as Parameters<
              typeof saveExperiment.mutateAsync
            >[0]["state"],
          });

          setExperimentId(updatedExperiment.id);
          setExperimentSlug(updatedExperiment.slug);
          setWorkbenchVersion(updatedExperiment.version);
          lastSavedRef.current = stringifiedState;
          // Our own save's broadcast can outrun this response; a staleness it
          // raised for a version this ack covers is not staleness.
          const staleNow = useEvaluationsV3Store.getState().staleWorkbench;
          if (staleNow && staleNow.serverVersion <= updatedExperiment.version) {
            setStaleWorkbench(undefined);
          }
          if (updatedExperiment.name && updatedExperiment.name !== name) {
            setName(updatedExperiment.name);
          }
          markSaved();
        } catch (error) {
          const handled = readHandledError(error);
          if (handled?.code === "experiment_stale_workbench_state") {
            // Someone else (another tab, Langy, the API) wrote a newer
            // version. Refuse-before-write means nothing was lost; autosave
            // stands down and the banner offers the reload. The current
            // server version rides in the error's meta when available.
            const serverVersion =
              typeof handled.meta?.currentVersion === "number"
                ? handled.meta.currentVersion
                : (workbenchVersion ?? 0) + 1;
            setStaleWorkbench({ serverVersion });
            setAutosaveStatus("evaluation", "error", "Out of date");
            return;
          }
          console.error("Failed to autosave evaluations v3:", error);
          setAutosaveStatus(
            "evaluation",
            "error",
            error instanceof Error ? error.message : "Unknown error",
          );
          toaster.create({
            title: "Failed to autosave evaluation",
            type: "error",
          });
          captureException(toError(error), {
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
    staleWorkbench,
    workbenchVersion,
  ]);

  // Determine if experiment was truly not found
  // Check if the error is a NOT_FOUND error (using multiple checks for robustness)
  const isNotFoundError =
    isTrpcNotFound(existingExperiment.error) ||
    existingExperiment.error?.data?.code === "NOT_FOUND" ||
    existingExperiment.error?.data?.httpStatus === 404;

  // isNotFound: query completed with error AND that error is NOT_FOUND
  const isNotFound = existingExperiment.isError && isNotFoundError;

  const trpcUtils = api.useUtils();

  const reset = useCallback(() => {
    loadedSlugRef.current = null;
    void trpcUtils.experiments.getEvaluationsV3BySlug.reset({
      projectId: project?.id ?? "",
      experimentSlug: routerSlug ?? "",
    });
  }, [project?.id, routerSlug, trpcUtils]);

  /**
   * Pull the server's current state into the store, discarding local edits.
   * The reconciliation path: the update listener calls it silently on a clean
   * workbench, and the stale banner's Reload button calls it on a dirty one.
   * Clearing `staleWorkbench` is what resumes autosave.
   */
  const reloadFromServer = useCallback(async () => {
    if (!project || !routerSlug) return;
    const fresh = await trpcUtils.experiments.getEvaluationsV3BySlug.fetch({
      projectId: project.id,
      experimentSlug: routerSlug,
    });
    setExperimentId(fresh.id);
    setExperimentSlug(fresh.slug);
    setWorkbenchVersion(fresh.version);
    if (fresh.workbenchState) {
      loadState(fresh.workbenchState);
    }
    setStaleWorkbench(undefined);
    setAutosaveStatus("evaluation", "idle");
    lastSavedRef.current = stringifyPersistedSnapshot();
    justLoadedRef.current = true;
  }, [
    project,
    routerSlug,
    trpcUtils,
    setExperimentId,
    setExperimentSlug,
    setWorkbenchVersion,
    setStaleWorkbench,
    setAutosaveStatus,
    loadState,
  ]);

  return {
    isLoading: existingExperiment.isLoading,
    isSaving: saveExperiment.isPending,
    existingExperiment: existingExperiment.data,
    isNotFound,
    // Only show isError for non-NOT_FOUND errors (e.g., permission denied)
    isError: existingExperiment.isError && !isNotFoundError,
    error: existingExperiment.error,
    reset: reset,
    /** True when the store differs from the last state the server acknowledged. */
    isDirty:
      lastSavedRef.current !== null &&
      stringifiedState !== lastSavedRef.current,
    reloadFromServer,
  };
};
