// Post-approval first-trace watch: hooks hold state and act on pure policy (first-trace-policy.ts).
// Polls until first trace lands, then redirects. React Query handles hidden tabs.
// Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature

import { useEffect, useMemo, useState } from "react";

import { useApiKeyHost } from "../model/api-key-host.ts";
import {
  FIRST_TRACE_POLL_TIMEOUT_MS,
  FIRST_TRACE_REDIRECT_DELAY_MS,
  resolveFirstTracePolling,
  resolveFirstTraceTransition,
} from "../model/first-trace-policy.ts";
import { findPersonalProject } from "../model/personal-project.ts";
import { apiKeyApi } from "./api-key-api.ts";

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
  const organizationId = host.scope().organizationId;

  const personalProject = useMemo(
    () => findPersonalProject({ organizations, userId, organizationId }),
    [organizations, userId, organizationId],
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

  return watchStateFor({
    hasProject: !!personalProject,
    hasPriorTraces,
    isTimedOut,
    isRedirecting,
    hasSeenNeverSynced,
  });
}

function watchStateFor(input: {
  hasProject: boolean;
  hasPriorTraces: boolean;
  isTimedOut: boolean;
  isRedirecting: boolean;
  hasSeenNeverSynced: boolean;
}): FirstTraceWatchState {
  if (!input.hasProject || input.hasPriorTraces || input.isTimedOut) return "hidden";
  if (input.isRedirecting) return "redirecting";
  if (input.hasSeenNeverSynced) return "waiting";
  return "hidden";
}
