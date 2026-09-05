import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSSESubscription } from "@langwatch/trace-web/hooks/useSSESubscription";
import {
  type ExperimentUpdateSignal,
  experimentUpdateSignalSchema,
} from "@langwatch/experiment-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import type { EvaluationsV3Actions } from "../../model/experiments-v3/types";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store";

/** Tab switches within this window share one staleness probe. */
const VISIBILITY_PROBE_MIN_INTERVAL_MS = 5_000;

/** Applies a server version to the open workbench, and reloads it on demand. */
type ApplyServerVersion = (update: {
  serverVersion: number;
  actorLabel?: string;
  /** The run that wrote it, when a run did. */
  runId?: string;
}) => void;

/**
 * True when this tab's own save is going to settle the version it just heard about, so
 * the signal is not news and acting on it only gets in the way.
 */
function thisTabWillAnswerFirst(isDirty: boolean): boolean {
  const state = useEvaluationsV3Store.getState();
  if (state.ui.autosaveStatus.evaluation === "saving") return true;
  if (state.ui.autosaveStatus.evaluation === "error") return false;
  return isDirty && !state.staleWorkbench;
}

/** A version that landed while a reload was already running. */
type MissedVersion = {
  serverVersion: number;
  actorLabel?: string;
  runId?: string;
};

/** Keeps the newest missed version, since an older one is already covered. */
const rememberMissedVersion = ({
  ref,
  serverVersion,
  actorLabel,
  runId,
}: {
  ref: MutableRefObject<MissedVersion | undefined>;
  serverVersion: number;
  actorLabel?: string;
  runId?: string;
}): void => {
  const missed = ref.current;
  if (missed && serverVersion <= missed.serverVersion) return;
  ref.current = {
    serverVersion,
    ...(actorLabel && { actorLabel }),
    ...(runId && { runId }),
  };
};

/**
 * What the page does about a version somebody else announced.
 */
type VersionAction = "ignore" | "adopt" | "banner" | "remember" | "reload";

/**
 * The rule, in order. Reading it as one list is the point: the reasons overlap,
 * and an earlier reason always wins.
 */
const decideVersionAction = ({
  serverVersion,
  known,
  runId,
  isDirty,
  isReloading,
}: {
  serverVersion: number;
  known: number | undefined;
  runId?: string;
  isDirty: boolean;
  isReloading: boolean;
}): VersionAction => {
  if (known === undefined || serverVersion <= known) return "ignore";
  // This page's own run, before every other rule.
  if (isOwnRunVersion(runId)) return "adopt";
  if (thisTabWillAnswerFirst(isDirty)) return "ignore";
  if (isDirty) return "banner";
  if (isReloading) return "remember";
  return "reload";
};

/**
 * Pulls, then runs the rule again over whatever was announced while it ran.
 */
const pullThenApplyMissed = async ({
  serverVersion,
  reload,
  reloadingRef,
  missedRef,
  apply,
}: {
  serverVersion: number;
  reload: () => Promise<void>;
  reloadingRef: MutableRefObject<boolean>;
  missedRef: MutableRefObject<MissedVersion | undefined>;
  apply: ApplyServerVersion;
}): Promise<void> => {
  await pullQuietly({ reload, serverVersion });
  reloadingRef.current = false;
  const missed = missedRef.current;
  missedRef.current = undefined;
  if (missed) apply(missed);
};

/**
 * True when this page started the run that wrote the version.
 */
const isOwnRunVersion = (runId: string | undefined): boolean =>
  Boolean(runId && useEvaluationsV3Store.getState().runsStartedHere?.includes(runId));

/**
 * Takes a version this page's own run wrote, and carries on saving.
 */
const adoptOwnRunVersion = (serverVersion: number): void => {
  const store = useEvaluationsV3Store.getState();
  store.setWorkbenchVersion(serverVersion);
  // Staleness this write already answers. A refusal raised by a DIFFERENT
  // writer at a newer version still stands.
  const stale = store.staleWorkbench;
  if (stale && stale.serverVersion <= serverVersion) {
    store.setStaleWorkbench(undefined);
  }
};

/**
 * Pulls the server state in, swallowing the failure.
 */
const pullQuietly = async ({
  reload,
  serverVersion,
}: {
  reload: () => Promise<void>;
  serverVersion: number;
}): Promise<void> => {
  try {
    await reload();
  } catch (error) {
    console.error("Failed to refresh the workbench from the server:", {
      error,
      serverVersion,
    });
  }
};

/**
 * The one rule both signals run: a newer server version reloads a CLEAN
 * workbench silently, and banners a DIRTY one so the user decides, because a
 * reload clears their edits.
 */
const useApplyServerVersion = ({
  isDirty,
  workbenchVersion,
  reloadFromServer,
  setStaleWorkbench,
}: {
  isDirty: boolean;
  workbenchVersion: number | undefined;
  reloadFromServer: () => Promise<void>;
  setStaleWorkbench: EvaluationsV3Actions["setStaleWorkbench"];
}): { applyServerVersion: ApplyServerVersion; reload: () => Promise<void> } => {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const versionRef = useRef(workbenchVersion);
  versionRef.current = workbenchVersion;
  const reloadRef = useRef(reloadFromServer);
  reloadRef.current = reloadFromServer;
  const reloadingRef = useRef(false);
  /**
   * The newest version announced while a reload was already running, and who wrote it.
   */
  const missedRef = useRef<MissedVersion | undefined>(undefined);

  const applyServerVersion = useCallback<ApplyServerVersion>(
    ({ serverVersion, actorLabel, runId }) => {
      const action = decideVersionAction({
        serverVersion,
        known: versionRef.current,
        runId,
        isDirty: isDirtyRef.current,
        isReloading: reloadingRef.current,
      });

      switch (action) {
        case "ignore":
          return;
        case "adopt":
          adoptOwnRunVersion(serverVersion);
          return;
        case "banner":
          setStaleWorkbench({ serverVersion, actorLabel });
          return;
        case "remember":
          rememberMissedVersion({
            ref: missedRef,
            serverVersion,
            actorLabel,
            runId,
          });
          return;
        case "reload":
          reloadingRef.current = true;
          void pullThenApplyMissed({
            serverVersion,
            reload: reloadRef.current,
            reloadingRef,
            missedRef,
            apply: applyServerVersion,
          });
          return;
      }
    },
    [setStaleWorkbench],
  );

  const reload = useCallback(async () => {
    await reloadRef.current();
  }, []);

  return { applyServerVersion, reload };
};

/**
 * The broadcast payload, or undefined when the frame is not one to act on.
 */
const parseUpdateSignal = (event: unknown): ExperimentUpdateSignal | undefined => {
  if (!event) return undefined;
  try {
    const raw = typeof event === "string" ? JSON.parse(event) : event;
    const result = experimentUpdateSignalSchema.safeParse(raw);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
};

/** The `experiment_updated` broadcast: a save landed, whoever wrote it. */
const useExperimentUpdateSignal = ({
  enabled,
  projectId,
  experimentSlug,
  applyServerVersion,
}: {
  enabled: boolean;
  projectId: string;
  experimentSlug: string | undefined;
  applyServerVersion: ApplyServerVersion;
}) => {
  useSSESubscription<{ event?: unknown; timestamp?: number }, { projectId: string }>(
    // @ts-expect-error - tRPC subscription type isn't inferred for the hook's generic
    api.experiments.onExperimentUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId && experimentSlug),
      onData: (data) => {
        const parsed = parseUpdateSignal(data.event);
        if (!parsed || parsed.slug !== experimentSlug) return;
        applyServerVersion({
          serverVersion: parsed.version,
          actorLabel: parsed.actorLabel,
          ...(parsed.runId ? { runId: parsed.runId } : {}),
        });
      },
    },
  );
};

/** A returning tab probes the version once, cheaply, and runs the same rule. */
const useVisibilityVersionProbe = ({
  enabled,
  projectId,
  experimentSlug,
  applyServerVersion,
}: {
  enabled: boolean;
  projectId: string;
  experimentSlug: string | undefined;
  applyServerVersion: ApplyServerVersion;
}) => {
  const trpcUtils = api.useUtils();
  const lastProbeAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !projectId || !experimentSlug) return;
    const probe = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastProbeAtRef.current < VISIBILITY_PROBE_MIN_INTERVAL_MS) {
        return;
      }
      lastProbeAtRef.current = now;
      void trpcUtils.experiments.getWorkbenchVersion
        .fetch({ projectId, experimentSlug })
        .then(({ version, actorLabel, runId }) =>
          applyServerVersion({
            serverVersion: version,
            ...(actorLabel ? { actorLabel } : {}),
            ...(runId ? { runId } : {}),
          }),
        )
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", probe);
    window.addEventListener("focus", probe);
    return () => {
      document.removeEventListener("visibilitychange", probe);
      window.removeEventListener("focus", probe);
    };
  }, [enabled, projectId, experimentSlug, trpcUtils, applyServerVersion]);
};

/**
 * Keeps an open workbench current with the server (specs/langy/
 * langy-ui-actions-fallback.feature).
 */
export function useWorkbenchUpdateListener({
  projectId,
  experimentSlug,
  isDirty,
  reloadFromServer,
  enabled = true,
}: {
  projectId: string;
  experimentSlug: string | undefined;
  isDirty: boolean;
  reloadFromServer: () => Promise<void>;
  enabled?: boolean;
}) {
  const { workbenchVersion, staleWorkbench, setStaleWorkbench } = useEvaluationsV3Store(
    useShallow((state) => ({
      workbenchVersion: state.workbenchVersion,
      staleWorkbench: state.staleWorkbench,
      setStaleWorkbench: state.setStaleWorkbench,
    })),
  );

  const { applyServerVersion, reload } = useApplyServerVersion({
    isDirty,
    workbenchVersion,
    reloadFromServer,
    setStaleWorkbench,
  });

  useExperimentUpdateSignal({
    enabled,
    projectId,
    experimentSlug,
    applyServerVersion,
  });
  useVisibilityVersionProbe({
    enabled,
    projectId,
    experimentSlug,
    applyServerVersion,
  });

  return { stale: staleWorkbench ?? null, reload };
}
