import posthog from "posthog-js";
import { useEffect } from "react";

/**
 * Fires a `trace_opened` PostHog event once per opened trace.
 *
 * Trace viewing is one of the actions that counts toward the active-user
 * KPI (alongside the run/create events), so every place that renders a
 * trace detail drawer — both the v1 drawer and the v2 shell — calls this
 * so the signal is captured regardless of which UI the operator lands on
 * or whether they arrived via an in-app click or a deep link.
 *
 * Client-side capture inherits the identified user and `$groups.organization`
 * set in usePostHogIdentify, so this attributes to a real person (and org)
 * without threading any identity or project context through.
 */
export function useTrackTraceOpened(
  traceId: string | undefined,
  version: "v1" | "v2",
): void {
  useEffect(() => {
    if (!traceId) return;
    posthog.capture("trace_opened", { traceId, version });
  }, [traceId, version]);
}
