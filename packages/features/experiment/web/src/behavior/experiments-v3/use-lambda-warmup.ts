import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store";

const WARMUP_INTERVAL_MS = 30_000; // Send warmup every 30 seconds

/**
 * Hook that silently warms up AWS Lambda instances used by langwatch_nlp.
 */
export const useLambdaWarmup = () => {
  const { project } = useOrganizationTeamProject();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPageVisibleRef = useRef(true);

  const concurrency = useEvaluationsV3Store(useShallow((state) => state.ui.concurrency ?? 10));

  // Calculate number of warmup requests: half of concurrency, min 1
  const warmupCount = Math.max(1, Math.floor(concurrency / 2));

  const warmupMutation = api.evaluations.warmupLambda.useMutation();

  // Use ref to avoid dependency on mutate function which changes every render
  const mutateRef = useRef(warmupMutation.mutate);
  mutateRef.current = warmupMutation.mutate;

  const sendWarmup = useCallback(() => {
    if (!isPageVisibleRef.current || !project) return;

    mutateRef.current({
      projectId: project.id,
      count: warmupCount,
    });
  }, [project, warmupCount]);

  // Set up interval for periodic warmup
  useEffect(() => {
    if (!project) return;

    // Send initial warmup request immediately
    sendWarmup();

    // Set up periodic warmup
    intervalRef.current = setInterval(sendWarmup, WARMUP_INTERVAL_MS);

    // Handle page visibility changes
    const handleVisibilityChange = () => {
      isPageVisibleRef.current = !document.hidden;
      if (!document.hidden) {
        // Page became visible, send warmup immediately and restart interval
        sendWarmup();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(sendWarmup, WARMUP_INTERVAL_MS);
      } else if (intervalRef.current) {
        // Page hidden, stop sending warmup requests
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [project, sendWarmup]);

  return null; // This hook has no return value, it just runs side effects
};
