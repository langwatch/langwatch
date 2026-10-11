// Post-approval first-trace watch: hooks hold state and act on pure policy (first-trace-policy.ts).
// Waits for the project's first trace on trace's live stream, then redirects.
// Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature

import { traceClient } from "@langwatch/trace-client";
import { useEffect, useState } from "react";

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

export function useFirstTraceWatch({
  organizationId,
}: {
  /** The organization the approval was granted for, never the page's ambient one (main's rule). */
  organizationId: string;
}): FirstTraceWatchState {
  const host = useApiKeyHost();
  const userId = host.currentUser()?.id ?? null;
  const organizations = host.organizations();

  const personalProject = findPersonalProject({ organizations, userId, organizationId });

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
    isRedirecting,
    isTimedOut,
    hasPriorTraces,
  });

  const utils = apiKeyApi.useUtils();
  const hasFirstMessage = apiKeyApi.project.getHasFirstMessage.useQuery(
    { projectId: personalProject?.id ?? "" },
    { enabled: polling.enabled, refetchOnWindowFocus: false },
  );

  // While waiting, an event on trace's stream IS the first trace: redirect before the flag
  // catches up (WEB-17707).
  traceClient.traces.onTraceUpdate.useSubscription(
    { projectId: personalProject?.id ?? "" },
    {
      enabled: polling.enabled && hasSeenNeverSynced,
      onData: () => {
        // The traces page we land on reads the same flag; tell it before the server can.
        if (personalProject) {
          utils.project.getHasFirstMessage.setData(
            { projectId: personalProject.id },
            { firstMessage: true },
          );
        }
        setIsRedirecting(true);
      },
    },
  );

  useEffect(() => {
    const firstMessage = hasFirstMessage.data?.firstMessage;
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
  }, [hasFirstMessage.data, hasSeenNeverSynced, isRedirecting, isTimedOut]);

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
