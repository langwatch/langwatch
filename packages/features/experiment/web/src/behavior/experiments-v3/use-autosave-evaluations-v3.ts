import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { readHandledError } from "@langwatch/workflow-web/studio-host/errors";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { captureException, toError } from "../../model/posthog-error-capture";
import { isNotFound as isTrpcNotFound } from "@langwatch/trace-web/utils/trpcError";
import { AUTOSAVE_OUT_OF_DATE_REASON } from "../../model/experiments-v3/constants";
import { createInitialState, type EvaluationsV3State } from "../../model/experiments-v3/types";
import {
  extractPersistedState,
  type PersistedEvaluationsV3State,
} from "../../model/experiments-v3/types/persistence";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store";

const AUTOSAVE_DEBOUNCE_MS = 1500; // Wait 1.5s after last change before saving

/** Everything the persisted projection reads, and nothing else. */
type PersistedProjectionSource = Pick<
  EvaluationsV3State,
  | "experimentId"
  | "experimentSlug"
  | "name"
  | "datasets"
  | "activeDatasetId"
  | "evaluators"
  | "targets"
  | "results"
> & { ui: Pick<EvaluationsV3State["ui"], "hiddenColumns" | "concurrency"> };

/**
 * The one persisted projection of the workbench.
 *
 * The render-scope value and the out-of-render snapshot are compared against
 * each other through `lastSavedRef`, so they have to be built the same way. A
 * field one of them carried and the other missed would make every render look
 * dirty and autosave a no-op change on every pass.
 */
const buildPersistedState = ({
  experimentId,
  experimentSlug,
  name,
  datasets,
  activeDatasetId,
  evaluators,
  targets,
  results,
  ui,
}: PersistedProjectionSource): PersistedEvaluationsV3State =>
  extractPersistedState({
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
      hiddenColumns: ui.hiddenColumns,
      autosaveStatus: { evaluation: "idle", dataset: "idle" },
      concurrency: ui.concurrency,
      hasRunThisSession: false,
    },
  });

const stringifiedInitialState = JSON.stringify(buildPersistedState(createInitialState()));

/**
 * The persisted projection of the store as it is RIGHT NOW, read outside the
 * render cycle. The load paths use it to record the saved baseline in the same
 * effect that loads the state: a render-scope string from the same commit
 * still describes the pre-load state, and capturing that made every page load
 * look dirty and autosave a no-op change.
 */
const readPersistedSnapshot = (): string =>
  JSON.stringify(buildPersistedState(useEvaluationsV3Store.getState()));

/**
 * What one `saveNow` did, for a caller that must not answer before the write
 * landed.
 *
 * An agent's UI action is that caller: it reports back "the document now says
 * this", and its next step reads the SAVED document. `"unchanged"` covers the
 * early returns, where nothing was sent because nothing needed sending, which
 * for that caller is as good as saved. `"refused"` is a newer version on the
 * server, which has its own answer. `"failed"` is everything else.
 */
export type AutosaveOutcome = "saved" | "unchanged" | "refused" | "failed";

/**
 * What a refusal leaves the save loop to do.
 *
 * `adopted` is the one case that is not an ending: the newer version came from
 * a run this page started, so the page takes that version and sends the same
 * edits again at it.
 */
type RefusalOutcome = AutosaveOutcome | "adopted";

/**
 * What a refusal says about the version the tab has to reload to, and who
 * wrote it.
 *
 * Someone else — another tab, Langy, the API — holds a newer version. Both
 * facts ride in the refusal's meta, and the actor is what lets the banner name
 * Langy instead of telling the reader the change came from "somewhere else"
 * while Langy was driving their own tab. An older server sends neither, so the
 * version falls back to "one past what this tab knows" and the actor to none.
 */
function refusedSaveStaleness({
  meta,
  knownVersion,
}: {
  meta?: Record<string, unknown>;
  knownVersion?: number;
}): { serverVersion: number; actorLabel?: string; runId?: string } {
  const serverVersion =
    typeof meta?.currentVersion === "number" ? meta.currentVersion : (knownVersion ?? 0) + 1;
  const actorLabel = typeof meta?.actorLabel === "string" ? meta.actorLabel : undefined;
  const runId = typeof meta?.runId === "string" ? meta.runId : undefined;
  return { serverVersion, actorLabel, runId };
}

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

  const persistedState = buildPersistedState({
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    evaluators,
    targets,
    results,
    ui: { hiddenColumns, concurrency },
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
      void router.replace(`/${project.slug}/experiments/workbench/${experimentSlug}`, undefined, {
        shallow: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, project?.slug]);

  // What the server last acknowledged, as the exact string this hook would
  // send. `stringifiedState !== lastSavedRef.current` is the ONE definition of
  // a dirty workbench; the update listener reads it through `isDirty` below.
  const lastSavedRef = useRef<string | null>(null);
  const justLoadedRef = useRef(false);

  /**
   * Record what the store holds after a load as the saved baseline, and decide
   * whether the autosave pass that follows has to be skipped.
   *
   * A load that replaced the projection leaves one pass holding the pre-load
   * render string, and that pass must not save it back. A load that replaced
   * nothing produces no pass at all, because the autosave effect only runs when
   * one of its inputs changed: arming the skip there would make the user's next
   * edit consume it, and that edit would never be saved.
   */
  const recordLoadedBaseline = useCallback(
    ({ snapshotBeforeLoad }: { snapshotBeforeLoad: string }) => {
      const snapshotAfterLoad = readPersistedSnapshot();
      lastSavedRef.current = snapshotAfterLoad;
      justLoadedRef.current = snapshotAfterLoad !== snapshotBeforeLoad;
    },
    [],
  );

  // Load existing experiment data into store
  useEffect(() => {
    if (existingExperiment.data && loadedSlugRef.current !== routerSlug) {
      const snapshotBeforeLoad = readPersistedSnapshot();

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
      recordLoadedBaseline({ snapshotBeforeLoad });
    }
  }, [
    existingExperiment.data,
    routerSlug,
    setExperimentId,
    setExperimentSlug,
    setWorkbenchVersion,
    setStaleWorkbench,
    loadState,
    recordLoadedBaseline,
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
            return path[0] === "experiments" && path[1] === "getEvaluationsV3BySlug";
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

  /**
   * What a refused autosave leaves behind.
   *
   * A refusal for a newer server version is not a failure to report: nothing
   * was lost, so autosave stands down and the banner offers the reload.
   * Everything else is a real error and is reported as one.
   *
   * Reads the store rather than the render scope. `saveNow` is memoized on the
   * project alone, so it keeps the first render's copy of this function for the
   * life of the hook, and a version or a count taken from that scope describes
   * the mount instead of the save that just failed.
   */
  const handleAutosaveFailure = ({
    error,
    snapshot,
  }: {
    error: unknown;
    snapshot: string;
  }): RefusalOutcome => {
    const state = useEvaluationsV3Store.getState();
    const handled = readHandledError(error);
    if (handled?.code === "experiment_stale_workbench_state") {
      const refusal = refusedSaveStaleness({
        meta: handled.meta,
        knownVersion: state.workbenchVersion,
      });
      // A run this page started wrote the newer version. The page already
      // holds every cell that run produced, so the refusal is about a write it
      // is not behind on. Take the version and send the edits again, rather
      // than standing autosave down and asking the reader to reload over them.
      if (refusal.runId && state.runsStartedHere?.includes(refusal.runId)) {
        setWorkbenchVersion(refusal.serverVersion);
        return "adopted";
      }
      setStaleWorkbench(refusal);
      setAutosaveStatus("evaluation", "error", AUTOSAVE_OUT_OF_DATE_REASON);
      return "refused";
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
    // Identifiers, sizes and counts only. The persisted state carries dataset
    // records, prompt text and run results, which are customer content and
    // must never reach telemetry.
    captureException(toError(error), {
      extra: {
        context: "Failed to autosave evaluations v3",
        projectId: project?.id,
        experimentId: state.experimentId,
        workbenchVersion: state.workbenchVersion,
        stateByteSize: snapshot.length,
        datasetCount: state.datasets.length,
        targetCount: state.targets.length,
        evaluatorCount: state.evaluators.length,
      },
    });
    return "failed";
  };

  /**
   * Save what the store holds RIGHT NOW, and answer when the server has it.
   *
   * Reads the store rather than the render-scope projection, because its two
   * callers both run before React has re-rendered: the debounce timer fires
   * from a commit that may already be a change behind, and an agent's UI
   * action calls it in the same tick as the mutation it just applied.
   *
   * Saves are chained rather than concurrent. Two overlapping saves send the
   * same `expectedVersion`, so the second is refused for a version the first
   * had just created, and the workbench reads as out of date against its own
   * write.
   *
   * Every link is made to settle. `.then` on a rejected promise skips its
   * callback, so a single throw anywhere in a save would leave the chain
   * permanently rejected and the page would never send another one, silently,
   * for the rest of its life.
   */
  const inFlightRef = useRef<Promise<AutosaveOutcome>>(Promise.resolve("unchanged"));
  const saveNow = useCallback((): Promise<AutosaveOutcome> => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    const attemptSave = async (
      { isRetry }: { isRetry: boolean } = {
        isRetry: false,
      },
    ): Promise<AutosaveOutcome> => {
      const state = useEvaluationsV3Store.getState();
      if (!project || !state.experimentId || !state.name) return "unchanged";
      // Out of date against the server: saving now would clobber the newer
      // version, so this waits for the reload like the debounced path does.
      if (state.staleWorkbench) return "refused";

      const snapshot = JSON.stringify(buildPersistedState(state));
      if (snapshot === lastSavedRef.current) return "unchanged";

      setAutosaveStatus("evaluation", "saving");
      try {
        const updatedExperiment = await saveExperiment.mutateAsync({
          projectId: project.id,
          experimentId: state.experimentId,
          expectedVersion: state.workbenchVersion,
          // Cast to any since the actual types are more complex than the schema
          // The schema is designed to be lenient for storage
          state: buildPersistedState(state) as Parameters<
            typeof saveExperiment.mutateAsync
          >[0]["state"],
        });

        setExperimentId(updatedExperiment.id);
        setExperimentSlug(updatedExperiment.slug);
        setWorkbenchVersion(updatedExperiment.version);
        lastSavedRef.current = snapshot;
        // Our own save's broadcast can outrun this response; a staleness it
        // raised for a version this ack covers is not staleness.
        const staleNow = useEvaluationsV3Store.getState().staleWorkbench;
        if (staleNow && staleNow.serverVersion <= updatedExperiment.version) {
          setStaleWorkbench(undefined);
        }
        if (updatedExperiment.name && updatedExperiment.name !== state.name) {
          setName(updatedExperiment.name);
        }
        markSaved();
        return "saved";
      } catch (error) {
        const outcome = handleAutosaveFailure({ error, snapshot });
        if (outcome !== "adopted") return outcome;
        // Once. A second refusal at the adopted version is a different writer,
        // and looping on it would spin against whoever is actually ahead.
        if (isRetry) {
          setStaleWorkbench(
            refusedSaveStaleness({
              meta: readHandledError(error)?.meta,
              knownVersion: useEvaluationsV3Store.getState().workbenchVersion,
            }),
          );
          setAutosaveStatus("evaluation", "error", AUTOSAVE_OUT_OF_DATE_REASON);
          return "refused";
        }
        return await attemptSave({ isRetry: true });
      }
    };
    const link = inFlightRef.current
      .then(() => attemptSave())
      .catch((error) => {
        // Reached only when the save threw outside its own guard: reporting the
        // failure, reading the store, or building the snapshot. Nothing was
        // written, and the next change gets a fresh attempt.
        console.error("Failed to autosave evaluations v3:", error);
        setAutosaveStatus(
          "evaluation",
          "error",
          error instanceof Error ? error.message : "Unknown error",
        );
        return "failed" as const;
      });
    inFlightRef.current = link;
    return link;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

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
      void saveNow();
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
    const snapshotBeforeLoad = readPersistedSnapshot();
    setExperimentId(fresh.id);
    setExperimentSlug(fresh.slug);
    setWorkbenchVersion(fresh.version);
    if (fresh.workbenchState) {
      loadState(fresh.workbenchState);
    }
    setStaleWorkbench(undefined);
    setAutosaveStatus("evaluation", "idle");
    recordLoadedBaseline({ snapshotBeforeLoad });
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
    recordLoadedBaseline,
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
    isDirty: lastSavedRef.current !== null && stringifiedState !== lastSavedRef.current,
    reloadFromServer,
    /**
     * Persist the current store immediately instead of waiting out the
     * debounce. An agent's edit has to be durable before the agent is told it
     * worked, because the agent's next move is usually a server-side one that
     * reads or writes the same document.
     */
    saveNow,
  };
};
