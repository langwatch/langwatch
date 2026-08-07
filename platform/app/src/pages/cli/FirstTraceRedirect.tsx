/**
 * Post-approval first-trace watcher for the CLI device-session flow.
 *
 * After the user approves a device session on /cli/auth, their next step in
 * the terminal is running the wrapped tool (e.g. `langwatch claude`) for the
 * first time. If their personal project has never received a trace, this
 * component politely polls until the first trace lands and then redirects to
 * the personal traces page, so the first thing they see is their own session.
 *
 * Behavior rules (specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature):
 * - Only the never-synced case watches: when the personal project already has
 *   traces on first read, the page keeps the plain success card.
 * - Polls every few seconds, only while the tab is visible, and gives up
 *   after a timeout instead of polling forever.
 * - Redirects with the SPA router to /<personal-project-slug>/traces.
 */
import { HStack, Icon, Spinner, Text } from "@chakra-ui/react";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";
import { useRouter } from "~/utils/compat/next-router";
import { findPersonalProject } from "~/utils/personalProject";

export const FIRST_TRACE_POLL_INTERVAL_MS = 3_000;
export const FIRST_TRACE_POLL_TIMEOUT_MS = 10 * 60_000;
const REDIRECT_DELAY_MS = 1_200;

/**
 * Pure polling policy: the query runs only while there is a project to watch
 * and nothing has concluded the watch (redirect underway, timeout reached, or
 * the project already had traces). The refetch interval additionally requires
 * either a confirmed never-synced state or no result yet, so a failed
 * initial read keeps retrying until the timeout instead of stalling.
 * Hidden tabs are covered by react-query itself: with the default
 * refetchIntervalInBackground (false), an interval query only ticks while
 * the tab is focused per the focus manager's visibilitychange handling.
 */
export function resolveFirstTracePolling({
  hasProject,
  hasResult,
  isRedirecting,
  isTimedOut,
  hasPriorTraces,
  hasSeenNeverSynced,
}: {
  hasProject: boolean;
  hasResult: boolean;
  isRedirecting: boolean;
  isTimedOut: boolean;
  hasPriorTraces: boolean;
  hasSeenNeverSynced: boolean;
}): { enabled: boolean; refetchInterval: number | false } {
  const enabled =
    hasProject && !isRedirecting && !isTimedOut && !hasPriorTraces;
  const refetchInterval =
    enabled && (hasSeenNeverSynced || !hasResult)
      ? FIRST_TRACE_POLL_INTERVAL_MS
      : false;
  return { enabled, refetchInterval };
}

/**
 * Pure transition policy for a first-trace read landing: confirm the
 * never-synced state, mark prior traces (which keeps the current behavior),
 * or start the redirect. A response that lands after the watch timed out
 * must not start a redirect, however late the network was.
 */
export function resolveFirstTraceTransition({
  firstMessage,
  hasSeenNeverSynced,
  isTimedOut,
}: {
  firstMessage: boolean | undefined;
  hasSeenNeverSynced: boolean;
  isTimedOut: boolean;
}): "none" | "confirm-never-synced" | "mark-prior-traces" | "redirect" {
  if (firstMessage === undefined) return "none";
  if (!firstMessage) {
    return hasSeenNeverSynced ? "none" : "confirm-never-synced";
  }
  if (!hasSeenNeverSynced) return "mark-prior-traces";
  if (isTimedOut) return "none";
  return "redirect";
}

type FirstTraceWatchState = "hidden" | "waiting" | "redirecting";

/**
 * Watches the personal project's first-trace flag and drives the redirect.
 * "waiting" is the confirmed never-synced poll, "redirecting" the brief
 * announcement before navigation; "hidden" covers every case that keeps the
 * current close-this-tab behavior.
 */
function useFirstTraceWatch(): FirstTraceWatchState {
  const router = useRouter();
  const { data: session } = useSession();
  const { organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const personalProject = useMemo(
    () => findPersonalProject({ organizations, userId: session?.user?.id }),
    [organizations, session?.user?.id],
  );

  const [hasResult, setHasResult] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [hasSeenNeverSynced, setHasSeenNeverSynced] = useState(false);
  const [hasPriorTraces, setHasPriorTraces] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(
      () => setIsTimedOut(true),
      FIRST_TRACE_POLL_TIMEOUT_MS,
    );
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

  const hasFirstMessage = api.project.getHasFirstMessage.useQuery(
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
  }, [
    hasFirstMessage.data,
    hasResult,
    hasSeenNeverSynced,
    isRedirecting,
    isTimedOut,
  ]);

  useEffect(() => {
    if (!isRedirecting || !personalProject?.slug) return;
    const slug = personalProject.slug;
    const timeout = setTimeout(() => {
      void router.push(`/${slug}/traces`);
    }, REDIRECT_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [isRedirecting, personalProject?.slug, router]);

  if (!personalProject || hasPriorTraces || isTimedOut) return "hidden";
  if (isRedirecting) return "redirecting";
  if (hasSeenNeverSynced) return "waiting";
  return "hidden";
}

export function FirstTraceRedirect() {
  const watchState = useFirstTraceWatch();

  if (watchState === "redirecting") {
    return (
      <HStack gap={2} role="status" aria-live="polite">
        <Icon as={CheckCircle2} boxSize={4} color="green.fg" />
        <Text textStyle="sm" color="fg.muted">
          First trace received. Taking you there now.
        </Text>
      </HStack>
    );
  }

  if (watchState === "waiting") {
    return (
      <HStack gap={2} role="status" aria-live="polite">
        <Spinner size="sm" color="orange.solidMuted" />
        <Text textStyle="sm" color="fg.muted">
          Waiting for your first trace. We will take you there when it arrives.
        </Text>
      </HStack>
    );
  }

  return null;
}
