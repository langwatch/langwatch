import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import {
  type ExperimentUpdateSignal,
  experimentUpdateSignalSchema,
} from "~/server/api/routers/experiments.schemas";
import { api } from "~/utils/api";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/** Tab switches within this window share one staleness probe. */
const VISIBILITY_PROBE_MIN_INTERVAL_MS = 5_000;

/**
 * Keeps an open workbench current with the server (specs/langy/
 * langy-ui-actions-fallback.feature).
 *
 * Two signals feed the same rule: the `experiment_updated` broadcast (a save
 * landed, whoever wrote it) and a version probe when the tab becomes visible
 * again. The rule: a CLEAN workbench reloads silently; a DIRTY one gets the
 * stale banner and the user decides: a reload clears their edits, so it is
 * never automatic.
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

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const versionRef = useRef(workbenchVersion);
  versionRef.current = workbenchVersion;
  const reloadRef = useRef(reloadFromServer);
  reloadRef.current = reloadFromServer;
  const reloadingRef = useRef(false);

  const applyServerVersion = useCallback(
    (serverVersion: number, actorLabel?: string) => {
      const known = versionRef.current;
      if (known === undefined || serverVersion <= known) return;
      if (isDirtyRef.current) {
        setStaleWorkbench({ serverVersion, actorLabel });
        return;
      }
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      void reloadRef.current().finally(() => {
        reloadingRef.current = false;
      });
    },
    [setStaleWorkbench],
  );

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

  // A returning tab probes the version once, cheaply, and runs the same rule.
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
        .then(({ version }) => applyServerVersion(version))
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", probe);
    window.addEventListener("focus", probe);
    return () => {
      document.removeEventListener("visibilitychange", probe);
      window.removeEventListener("focus", probe);
    };
  }, [enabled, projectId, experimentSlug, trpcUtils, applyServerVersion]);

  return {
    stale: staleWorkbench ?? null,
    reload: useCallback(async () => {
      await reloadRef.current();
    }, []),
  };
}
