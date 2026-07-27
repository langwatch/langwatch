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
import { useSession } from "~/utils/auth-client";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export const FIRST_TRACE_POLL_INTERVAL_MS = 3_000;
export const FIRST_TRACE_POLL_TIMEOUT_MS = 10 * 60_000;
const REDIRECT_DELAY_MS = 1_200;

/**
 * Pure polling policy: the query runs only while there is a project to watch
 * and nothing has concluded the watch (redirect underway, timeout reached, or
 * the project already had traces). The refetch interval additionally requires
 * that we have confirmed the never-synced state and that the tab is visible,
 * so a hidden tab or an already-synced project never ticks the network.
 */
export function resolveFirstTracePolling({
  hasProject,
  redirecting,
  timedOut,
  alreadyHadTraces,
  sawNeverSynced,
  isVisible,
}: {
  hasProject: boolean;
  redirecting: boolean;
  timedOut: boolean;
  alreadyHadTraces: boolean;
  sawNeverSynced: boolean;
  isVisible: boolean;
}): { enabled: boolean; refetchInterval: number | false } {
  const enabled = hasProject && !redirecting && !timedOut && !alreadyHadTraces;
  const refetchInterval =
    enabled && sawNeverSynced && isVisible ? FIRST_TRACE_POLL_INTERVAL_MS : false;
  return { enabled, refetchInterval };
}

export function FirstTraceRedirect() {
  const router = useRouter();
  const { data: session } = useSession();
  const { organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  // Same resolution PersonalSidebar uses: the personal team owned by the
  // signed-in user carries exactly one personal project.
  const personalProject = useMemo(() => {
    const userId = session?.user?.id;
    if (!userId || !organizations) return null;
    for (const org of organizations) {
      for (const team of org.teams ?? []) {
        if (team.isPersonal && team.ownerUserId === userId) {
          const project = team.projects?.[0];
          if (project) return { id: project.id, slug: project.slug };
        }
      }
    }
    return null;
  }, [organizations, session?.user?.id]);

  const [isVisible, setIsVisible] = useState<boolean>(
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const [timedOut, setTimedOut] = useState(false);
  const [sawNeverSynced, setSawNeverSynced] = useState(false);
  const [alreadyHadTraces, setAlreadyHadTraces] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const onVisibility = () =>
      setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(
      () => setTimedOut(true),
      FIRST_TRACE_POLL_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, []);

  const polling = resolveFirstTracePolling({
    hasProject: !!personalProject?.id,
    redirecting,
    timedOut,
    alreadyHadTraces,
    sawNeverSynced,
    isVisible,
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
    if (firstMessage === undefined) return;
    if (!firstMessage) {
      if (!sawNeverSynced) setSawNeverSynced(true);
      return;
    }
    // Users whose project already had traces keep the current behavior; only
    // a false -> true transition observed on this page triggers the redirect.
    if (!sawNeverSynced) {
      setAlreadyHadTraces(true);
      return;
    }
    if (!redirecting) setRedirecting(true);
  }, [hasFirstMessage.data, sawNeverSynced, redirecting]);

  useEffect(() => {
    if (!redirecting || !personalProject?.slug) return;
    const slug = personalProject.slug;
    const timeout = setTimeout(() => {
      void router.push(`/${slug}/traces`);
    }, REDIRECT_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [redirecting, personalProject?.slug, router]);

  if (!personalProject || alreadyHadTraces || timedOut) return null;

  if (redirecting) {
    return (
      <HStack gap={2} role="status" aria-live="polite">
        <Icon as={CheckCircle2} boxSize={4} color="green.fg" />
        <Text textStyle="sm" color="fg.muted">
          First trace received. Taking you there now.
        </Text>
      </HStack>
    );
  }

  if (sawNeverSynced) {
    return (
      <HStack gap={2} role="status" aria-live="polite">
        <Spinner size="sm" color="orange.400" />
        <Text textStyle="sm" color="fg.muted">
          Waiting for your first trace. We will take you there when it arrives.
        </Text>
      </HStack>
    );
  }

  return null;
}
