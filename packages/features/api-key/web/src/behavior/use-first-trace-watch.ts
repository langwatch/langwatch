/**
 * The post-approval first-trace watch, as state.
 *
 * The stateful half of `platform/app/src/pages/cli/FirstTraceRedirect.tsx`; the
 * decisions it makes are pure and live in `model/first-trace-policy.ts`, so this
 * hook only holds what has happened so far and acts on the answer.
 *
 * After the user approves a device session on `/cli/auth`, their next step in
 * the terminal is running the wrapped tool (e.g. `langwatch claude`) for the
 * first time. If their personal project has never received a trace, this watch
 * polls until the first one lands and then redirects to the personal traces
 * page, so the first thing they see is their own session.
 *
 * Hidden tabs are covered by React Query itself: with the default
 * `refetchIntervalInBackground` (false), an interval query only ticks while the
 * tab is focused, per the focus manager's `visibilitychange` handling. That
 * option is deliberately never overridden, and the suite asserts so.
 *
 * Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */

import { useEffect, useMemo, useState } from "react";
import {
  FIRST_TRACE_POLL_TIMEOUT_MS,
  FIRST_TRACE_REDIRECT_DELAY_MS,
  resolveFirstTracePolling,
  resolveFirstTraceTransition,
} from "../model/first-trace-policy";
import { useApiKeyHost } from "../model/api-key-host";
import { findPersonalProject } from "../model/personal-project";
import { apiKeyApi } from "./api-key-api";

/**
 * "waiting" is the confirmed never-synced poll, "redirecting" the brief
 * announcement before navigation; "hidden" covers every case that keeps the
 * plain close-this-tab success card.
 */
export type FirstTraceWatchState = "hidden" | "waiting" | "redirecting";

export function useFirstTraceWatch(): FirstTraceWatchState {
  const host = useApiKeyHost();
  const userId = host.currentUser()?.id ?? null;
  const organizations = host.organizations();

  const personalProject = useMemo(
    () => findPersonalProject({ organizations, userId }),
    [organizations, userId],
  );

  const [hasResult, setHasResult] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [hasSeenNeverSynced, setHasSeenNeverSynced] = useState(false);
  const [hasPriorTraces, setHasPriorTraces] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setIsTimedOut(true), FIRST_TRACE_POLL_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  const polling = resolveFirstTracePolling({
    hasProject: !!personalProject?.id,
    hasResult,
    isRedirecting,
    isTimedOut,
    hasPriorTraces,
    hasSeenNeverSynced,
  });

  const hasFirstMessage = apiKeyApi.project.getHasFirstMessage.useQuery(
    { projectId: personalProject?.id ?? "" },
    {
      enabled: polling.enabled,
      refetchInterval: polling.refetchInterval,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    const firstMessage = hasFirstMessage.data?.firstMessage;
    if (firstMessage !== undefined && !hasResult) setHasResult(true);
    // Users whose project already had traces keep the current behavior; only
    // a false -> true transition observed on this page, before the timeout,
    // triggers the redirect.
    const transition = resolveFirstTraceTransition({
      firstMessage,
      hasSeenNeverSynced,
      isTimedOut,
    });
    if (transition === "confirm-never-synced") setHasSeenNeverSynced(true);
    if (transition === "mark-prior-traces") setHasPriorTraces(true);
    if (transition === "redirect" && !isRedirecting) setIsRedirecting(true);
  }, [hasFirstMessage.data, hasResult, hasSeenNeverSynced, isRedirecting, isTimedOut]);

  const slug = personalProject?.slug;
  useEffect(() => {
    if (!isRedirecting || !slug) return;
    const timeout = setTimeout(() => {
      host.navigate(`/${slug}/traces`);
    }, FIRST_TRACE_REDIRECT_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [isRedirecting, slug, host]);

  if (!personalProject || hasPriorTraces || isTimedOut) return "hidden";
  if (isRedirecting) return "redirecting";
  if (hasSeenNeverSynced) return "waiting";
  return "hidden";
}
