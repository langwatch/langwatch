import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import {
  type ExperimentUpdateSignal,
  experimentUpdateSignalSchema,
} from "~/server/api/routers/experiments.schemas";
import { api } from "~/utils/api";
import type { EvaluationsV3Actions } from "../types";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/** Tab switches within this window share one staleness probe. */
const VISIBILITY_PROBE_MIN_INTERVAL_MS = 5_000;

/** Applies a server version to the open workbench, and reloads it on demand. */
type ApplyServerVersion = (serverVersion: number, actorLabel?: string) => void;

/**
 * True when this tab's own save is going to settle the version it just heard
 * about, so the signal is not news and acting on it only gets in the way.
 *
 * A save in flight is usually the very write the signal announces, and its
 * response carries the truth: the new version, or the stale error. Unsaved
 * edits mean a save is on its way for the same reason — autosave arms on every
 * change. Bannering instead of waiting told the reader their work clashed with
 * "somewhere else" while Langy was driving THIS tab, seconds before their own
 * save landed and settled it.
 *
 * An autosave that ERRORED is the case where nothing is coming. A failed
 * attempt schedules no retry, so the workbench stays dirty with no answer on
 * the way, and treating that as "wait" would leave the tab silent for as long
 * as the reader makes no further edit. Once autosave has stood down the signal
 * is the only word there is, whether it stood down on an error or on a refusal
 * (which stands it down and marks the workbench stale).
 */
function thisTabWillAnswerFirst(isDirty: boolean): boolean {
  const state = useEvaluationsV3Store.getState();
  if (state.ui.autosaveStatus.evaluation === "saving") return true;
  if (state.ui.autosaveStatus.evaluation === "error") return false;
  return isDirty && !state.staleWorkbench;
}

/** A version that landed while a reload was already running. */
type MissedVersion = { serverVersion: number; actorLabel?: string };

/** Keeps the newest missed version, since an older one is already covered. */
const rememberMissedVersion = ({
  ref,
  serverVersion,
  actorLabel,
}: {
  ref: MutableRefObject<MissedVersion | undefined>;
  serverVersion: number;
  actorLabel?: string;
}): void => {
  const missed = ref.current;
  if (missed && serverVersion <= missed.serverVersion) return;
  ref.current = { serverVersion, ...(actorLabel && { actorLabel }) };
};

/**
 * Pulls the server state in, swallowing the failure.
 *
 * No one asked for this pull, so nothing is lost when it fails and a toast
 * would interrupt the user for work they did not start. The page keeps the
 * version it has, and the next update signal or the next time the tab becomes
 * visible tries again.
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
   * The newest version announced while a reload was already running, and who
   * wrote it.
   *
   * One agent turn that duplicates a target, writes its prompt and runs it is
   * three saves in a row. Dropping the later signals outright left the page on
   * whatever the in-flight fetch happened to bring back: if it had left the
   * server before the new target was written, the page never learned that
   * target existed and its cells read "No output yet" until a manual reload.
   */
  const missedRef = useRef<MissedVersion | undefined>(undefined);

  const applyServerVersion = useCallback<ApplyServerVersion>(
    (serverVersion, actorLabel) => {
      const known = versionRef.current;
      if (known === undefined || serverVersion <= known) return;
      if (thisTabWillAnswerFirst(isDirtyRef.current)) return;
      if (isDirtyRef.current) {
        setStaleWorkbench({ serverVersion, actorLabel });
        return;
      }
      if (reloadingRef.current) {
        rememberMissedVersion({ ref: missedRef, serverVersion, actorLabel });
        return;
      }
      reloadingRef.current = true;
      void (async () => {
        await pullQuietly({ reload: reloadRef.current, serverVersion });
        reloadingRef.current = false;
        const missed = missedRef.current;
        missedRef.current = undefined;
        // Re-run the same rule rather than reloading outright: the reload that
        // just finished may already have carried this version, and the
        // workbench may have gone dirty while it ran.
        if (missed) applyServerVersion(missed.serverVersion, missed.actorLabel);
      })();
    },
    [setStaleWorkbench],
  );

  const reload = useCallback(async () => {
    await reloadRef.current();
  }, []);

  return { applyServerVersion, reload };
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
  useSSESubscription<
    { event?: unknown; timestamp?: number },
    { projectId: string }
  >(
    // @ts-expect-error - tRPC subscription type isn't inferred for the hook's generic
    api.experiments.onExperimentUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId && experimentSlug),
      onData: (data) => {
        if (!data.event) return;
        let parsed: ExperimentUpdateSignal;
        try {
          const raw =
            typeof data.event === "string"
              ? JSON.parse(data.event)
              : data.event;
          const result = experimentUpdateSignalSchema.safeParse(raw);
          if (!result.success) return;
          parsed = result.data;
        } catch {
          return;
        }
        if (parsed.slug !== experimentSlug) return;
        applyServerVersion(parsed.version, parsed.actorLabel);
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
        .then(({ version, actorLabel }) =>
          applyServerVersion(version, actorLabel),
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
 *
 * Two signals feed the same rule: the `experiment_updated` broadcast (a save
 * landed, whoever wrote it) and a version probe when the tab becomes visible
 * again.
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
  const { workbenchVersion, staleWorkbench, setStaleWorkbench } =
    useEvaluationsV3Store(
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
