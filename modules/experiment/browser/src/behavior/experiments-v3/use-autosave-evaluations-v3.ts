import { isNotFoundError as isTrpcNotFound } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { AUTOSAVE_OUT_OF_DATE_REASON } from "../../model/experiments-v3/constants.ts";
import { createInitialState, type EvaluationsV3State } from "../../model/experiments-v3/types.ts";
import {
  extractPersistedState,
  type PersistedEvaluationsV3State,
} from "../../model/experiments-v3/types/persistence.ts";
import { captureException, toError } from "../../model/posthog-error-capture.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

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
 * The persisted projection of the store as it is RIGHT NOW, read outside the render
 * cycle.
 */
const readPersistedSnapshot = (): string =>
  JSON.stringify(buildPersistedState(useEvaluationsV3Store.getState()));

/**
 * What one `saveNow` did, for a caller that must not answer before the write landed.
 */
export type AutosaveOutcome = "saved" | "unchanged" | "refused" | "failed";

/**
 * What a refusal leaves the save loop to do.
 */
type RefusalOutcome = AutosaveOutcome | "adopted";

/**
 * What a refusal says about the version the tab has to reload to, and who wrote it.
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

/** tRPC query keys like [["experiments", "getEvaluationsV3BySlug"], ...]. */
const isEvaluationsV3BySlugQuery = (query: { queryKey: readonly unknown[] }): boolean => {
  const [path] = query.queryKey;
  return Array.isArray(path) && path[0] === "experiments" && path[1] === "getEvaluationsV3BySlug";
};

/** An unexpected autosave failure: logged, shown in the status and toasted. */
const reportUnexpectedSaveFailure = (error: unknown): void => {
  console.error("Failed to autosave evaluations v3:", error);
  useEvaluationsV3Store
    .getState()
    .setAutosaveStatus(
      "evaluation",
      "error",
      error instanceof Error ? error.message : "Unknown error",
    );
};

/**
 * What a refused autosave leaves behind. A stale-version refusal caused by a run
 * this page started is adopted (the page already holds that run's cells); any
 * other stale refusal stands autosave down; anything else is a failure.
 */
const handleAutosaveFailure = ({
  error,
  snapshot,
  projectId,
}: {
  error: unknown;
  snapshot: string;
  projectId: string | undefined;
}): RefusalOutcome => {
  const state = useEvaluationsV3Store.getState();
  const handled = readHandledError(error);
  if (handled?.code === "experiment_stale_workbench_state") {
    const refusal = refusedSaveStaleness({
      meta: handled.meta,
      knownVersion: state.workbenchVersion,
    });
    if (refusal.runId && state.runsStartedHere?.includes(refusal.runId)) {
      state.setWorkbenchVersion(refusal.serverVersion);
      return "adopted";
    }
    state.setStaleWorkbench(refusal);
    state.setAutosaveStatus("evaluation", "error", AUTOSAVE_OUT_OF_DATE_REASON);
    return "refused";
  }
  reportUnexpectedSaveFailure(error);
  toaster.create({ title: "Failed to autosave evaluation", type: "error" });
  // Identifiers, sizes and counts only: the state carries customer content.
  captureException(toError(error), {
    extra: {
      context: "Failed to autosave evaluations v3",
      projectId,
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

/** The server's acknowledgement of a save, taken into the store. */
const acceptSavedExperiment = ({
  saved,
  sentName,
}: {
  saved: { id: string; slug: string; version: number; name?: string | null };
  sentName: string;
}): void => {
  const store = useEvaluationsV3Store.getState();
  store.setExperimentId(saved.id);
  store.setExperimentSlug(saved.slug);
  store.setWorkbenchVersion(saved.version);
  // Our own save's broadcast can outrun this response; a staleness it raised
  // for a version this ack covers is not staleness.
  const staleNow = useEvaluationsV3Store.getState().staleWorkbench;
  if (staleNow && staleNow.serverVersion <= saved.version) store.setStaleWorkbench(undefined);
  if (saved.name && saved.name !== sentName) store.setName(saved.name);
};

/** A second stale refusal at the adopted version: a different writer is ahead, so stand down. */
const standDownAfterRetry = (error: unknown): AutosaveOutcome => {
  const store = useEvaluationsV3Store.getState();
  store.setStaleWorkbench(
    refusedSaveStaleness({
      meta: readHandledError(error)?.meta,
      knownVersion: store.workbenchVersion,
    }),
  );
  store.setAutosaveStatus("evaluation", "error", AUTOSAVE_OUT_OF_DATE_REASON);
  return "refused";
};

type SavedExperiment = { id: string; slug: string; version: number; name?: string | null };

type SaveWorkbench = (input: {
  projectId: string;
  experimentId: string;
  expectedVersion: number | undefined;
  state: PersistedEvaluationsV3State;
}) => Promise<SavedExperiment>;

/**
 * One save of what the store holds now. Skipped with no experiment yet, refused
 * while out of date (saving would clobber the newer version), unchanged when the
 * server already has it. A run-caused stale refusal is adopted and retried once.
 */
const attemptSave = async ({
  projectId,
  save,
  lastSavedRef,
  markSaved,
  isRetry,
}: {
  projectId: string | undefined;
  save: SaveWorkbench;
  lastSavedRef: { current: string | null };
  markSaved: () => void;
  isRetry: boolean;
}): Promise<AutosaveOutcome> => {
  const state = useEvaluationsV3Store.getState();
  if (!projectId || !state.experimentId || !state.name) return "unchanged";
  if (state.staleWorkbench) return "refused";
  const persisted = buildPersistedState(state);
  const snapshot = JSON.stringify(persisted);
  if (snapshot === lastSavedRef.current) return "unchanged";

  state.setAutosaveStatus("evaluation", "saving");
  try {
    const saved = await save({
      projectId,
      experimentId: state.experimentId,
      expectedVersion: state.workbenchVersion,
      state: persisted,
    });
    acceptSavedExperiment({ saved, sentName: state.name });
    lastSavedRef.current = snapshot;
    markSaved();
    return "saved";
  } catch (error) {
    const outcome = handleAutosaveFailure({ error, snapshot, projectId });
    if (outcome !== "adopted") return outcome;
    // Retried once only: looping would spin against whoever is actually ahead.
    return isRetry
      ? standDownAfterRetry(error)
      : attemptSave({ projectId, save, lastSavedRef, markSaved, isRetry: true });
  }
};

/** Cancel a pending timeout and forget it. */
const clearTimer = (ref: { current: ReturnType<typeof setTimeout> | null }): void => {
  if (ref.current) clearTimeout(ref.current);
  ref.current = null;
};

/** The server's copy of an experiment, taken into the store over whatever it held. */
const loadExperimentIntoStore = (data: {
  id: string;
  slug: string;
  version: number;
  workbenchState?: unknown;
}): void => {
  const store = useEvaluationsV3Store.getState();
  store.setExperimentId(data.id);
  store.setExperimentSlug(data.slug);
  store.setWorkbenchVersion(data.version);
  store.setStaleWorkbench(undefined);
  if (data.workbenchState) store.loadState(data.workbenchState);
};

/**
 * Whether the debounced autosave should arm: never while loading or about to load
 * (that saves blank or stale data), before the experiment exists and is named, while
 * out of date, or when nothing differs from the initial state or the last save.
 */
const autosaveIsDue = ({
  hasProject,
  isLoadingExisting,
  shouldLoadExisting,
  experimentId,
  name,
  staleWorkbench,
  stringifiedState,
  lastSaved,
}: {
  hasProject: boolean;
  isLoadingExisting: boolean;
  shouldLoadExisting: boolean;
  experimentId: string | undefined;
  name: string;
  staleWorkbench: boolean;
  stringifiedState: string;
  lastSaved: string | null;
}): boolean =>
  hasProject &&
  !isLoadingExisting &&
  !shouldLoadExisting &&
  !!experimentId &&
  !!name &&
  !staleWorkbench &&
  stringifiedState !== stringifiedInitialState &&
  stringifiedState !== lastSaved;

/** A NOT_FOUND read of the experiment, however the error layer spelled it. */
const isExperimentNotFound = (
  error: { data?: { code?: string; httpStatus?: number } | null } | null | undefined,
): boolean =>
  isTrpcNotFound(error) || error?.data?.code === "NOT_FOUND" || error?.data?.httpStatus === 404;

/** Whether the URL names an experiment this store has not loaded yet. */
const needsExistingLoad = ({
  hasProject,
  routerSlug,
  experimentSlug,
  loadedSlug,
}: {
  hasProject: boolean;
  routerSlug: string | undefined;
  experimentSlug: string | undefined;
  loadedSlug: string | null;
}): boolean =>
  hasProject && !!routerSlug && experimentSlug !== routerSlug && loadedSlug !== routerSlug;

/**
 * Loads the experiment the URL names into the store once per slug, and keeps the
 * URL on the store's slug after a save creates or renames it.
 */
const useWorkbenchLoad = ({
  experimentSlug,
  recordLoadedBaseline,
}: {
  experimentSlug: string | undefined;
  recordLoadedBaseline: (input: { snapshotBeforeLoad: string }) => void;
}) => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  // The slug THIS component instance loaded: no reload per render, but a reload
  // after navigating away and back.
  const loadedSlugRef = useRef<string | null>(null);
  const routerSlug = router.query.slug as string | undefined;

  // Detect if the store was reset while component stayed mounted. This happens
  // when user navigates away and back; reset the ref if experimentSlug changed.
  if (loadedSlugRef.current === routerSlug && experimentSlug !== routerSlug) {
    loadedSlugRef.current = null;
  }

  // Determine if we need to load the experiment from the database. We should load if:
  // 1. We have a project and a slug in the URL 2.
  const shouldLoadExisting = needsExistingLoad({
    hasProject: !!project,
    routerSlug,
    experimentSlug,
    loadedSlug: loadedSlugRef.current,
  });

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
    if (!project || !experimentSlug || routerSlug === experimentSlug) return;
    void router.replace(`/${project.slug}/experiments/workbench/${experimentSlug}`, undefined, {
      shallow: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, project?.slug]);

  // Load existing experiment data into store
  useEffect(() => {
    if (!existingExperiment.data || loadedSlugRef.current === routerSlug) return;
    const snapshotBeforeLoad = readPersistedSnapshot();
    // Mark this slug as loaded BEFORE updating the store, against races.
    loadedSlugRef.current = routerSlug ?? null;
    loadExperimentIntoStore(existingExperiment.data);
    recordLoadedBaseline({ snapshotBeforeLoad });
  }, [existingExperiment.data, routerSlug, loadedSlugRef, recordLoadedBaseline]);

  return { routerSlug, shouldLoadExisting, existingExperiment, loadedSlugRef };
};

/**
 * Manages syncing the evaluations v3 state with the database. Uses workbenchState field
 * in the Experiment model for persistence.
 */
export const useAutosaveEvaluationsV3 = () => {
  const { project } = useOrganizationTeamProject();
  const queryClient = useQueryClient();
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setAutosaveStatus,
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
      setAutosaveStatus: state.setAutosaveStatus,
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

  // What the server last acknowledged, as the exact string this hook would
  // send. `stringifiedState !== lastSavedRef.current` is the ONE definition of
  // a dirty workbench; the update listener reads it through `isDirty` below.
  const lastSavedRef = useRef<string | null>(null);
  const justLoadedRef = useRef(false);

  /**
   * Record what the store holds after a load as the saved baseline, and decide whether
   * the autosave pass that follows has to be skipped.
   */
  const recordLoadedBaseline = useCallback(
    ({ snapshotBeforeLoad }: { snapshotBeforeLoad: string }) => {
      const snapshotAfterLoad = readPersistedSnapshot();
      lastSavedRef.current = snapshotAfterLoad;
      justLoadedRef.current = snapshotAfterLoad !== snapshotBeforeLoad;
    },
    [],
  );

  const { routerSlug, shouldLoadExisting, existingExperiment, loadedSlugRef } = useWorkbenchLoad({
    experimentSlug,
    recordLoadedBaseline,
  });

  // Clear timeouts and invalidate query cache on unmount
  // Invalidating the cache ensures that when user navigates back,
  // fresh data is fetched from DB instead of returning stale cached data
  useEffect(() => {
    return () => {
      clearTimer(savedTimeoutRef);
      clearTimer(debounceTimeoutRef);
      // A return visit fetches fresh data instead of this cached copy.
      if (routerSlug) void queryClient.invalidateQueries({ predicate: isEvaluationsV3BySlugQuery });
    };
  }, [queryClient, routerSlug]);

  // Transition to "saved" then back to "idle" after delay
  const markSaved = useCallback(() => {
    setAutosaveStatus("evaluation", "saved");
    clearTimer(savedTimeoutRef);
    savedTimeoutRef.current = setTimeout(() => {
      setAutosaveStatus("evaluation", "idle");
    }, 2000);
  }, [setAutosaveStatus]);

  /**
   * Save what the store holds RIGHT NOW, and answer when the server has it.
   */
  const inFlightRef = useRef<Promise<AutosaveOutcome>>(Promise.resolve("unchanged"));
  const saveNow = useCallback((): Promise<AutosaveOutcome> => {
    clearTimer(debounceTimeoutRef);
    const save: SaveWorkbench = (input) =>
      saveExperiment.mutateAsync({
        ...input,
        // The schema is lenient for storage; the live types are richer than it.
        state: input.state as Parameters<typeof saveExperiment.mutateAsync>[0]["state"],
      });
    const link = inFlightRef.current
      .then(() =>
        attemptSave({ projectId: project?.id, save, lastSavedRef, markSaved, isRetry: false }),
      )
      .catch((error) => {
        // Only a throw outside the save's own guard lands here; nothing was
        // written, and the next change gets a fresh attempt.
        reportUnexpectedSaveFailure(error);
        return "failed" as const;
      });
    inFlightRef.current = link;
    return link;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Autosave effect with debounce
  useEffect(() => {
    // The pass in the same commit as a load still sees the pre-load string;
    // the load effect already recorded the real baseline.
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      return;
    }
    const isDue = autosaveIsDue({
      hasProject: !!project,
      isLoadingExisting: existingExperiment.isLoading,
      shouldLoadExisting,
      experimentId,
      name,
      staleWorkbench: !!staleWorkbench,
      stringifiedState,
      lastSaved: lastSavedRef.current,
    });
    if (!isDue) return;

    clearTimer(debounceTimeoutRef);
    // Set debounced save - waits until user stops making changes
    debounceTimeoutRef.current = setTimeout(() => {
      void saveNow();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimer(debounceTimeoutRef);
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
  const isNotFoundError = isExperimentNotFound(existingExperiment.error);

  // isNotFound: query completed with error AND that error is NOT_FOUND
  const isNotFound = existingExperiment.isError && isNotFoundError;

  const trpcUtils = api.useUtils();

  const reset = useCallback(() => {
    loadedSlugRef.current = null;
    void trpcUtils.experiments.getEvaluationsV3BySlug.reset({
      projectId: project?.id ?? "",
      experimentSlug: routerSlug ?? "",
    });
  }, [project?.id, routerSlug, trpcUtils, loadedSlugRef]);

  /**
   * Pull the server's current state into the store, discarding local edits. The
   * reconciliation path: the update listener calls it silently on a clean workbench,
   * and the stale banner's Reload button calls it on a dirty one.
   */
  const reloadFromServer = useCallback(async () => {
    if (!project || !routerSlug) return;
    const fresh = await trpcUtils.experiments.getEvaluationsV3BySlug.fetch({
      projectId: project.id,
      experimentSlug: routerSlug,
    });
    const snapshotBeforeLoad = readPersistedSnapshot();
    loadExperimentIntoStore(fresh);
    setAutosaveStatus("evaluation", "idle");
    recordLoadedBaseline({ snapshotBeforeLoad });
  }, [project, routerSlug, trpcUtils, setAutosaveStatus, recordLoadedBaseline]);

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
     * Persist the current store immediately instead of waiting out the debounce.
     */
    saveNow,
  };
};
