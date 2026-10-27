import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import { useRequiredSession } from "../../../../behavior/auth-session.ts";
import { useTraceHost } from "../../../../behavior/trace-host.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { LANGY_RELEASE_FLAG } from "../../../../model/langy-release-flag.ts";

/**
 * Langy's visibility gate — "does this user have Langy?". Three layers:
 */
export interface LangyVisibility {
  /** Does this user have Langy? */
  show: boolean;
  /**
   * We do not KNOW yet — the session, the project, or the rollout flag is still in
   * flight.
   */
  isResolving: boolean;
}

/** The gate, with its own uncertainty exposed. See {@link LangyVisibility}. */
export function useLangyVisibility(): LangyVisibility {
  const { status: sessionStatus } = useRequiredSession();
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const traceHost = useTraceHost();
  const { demoProjectSlug } = useUiDeployment();

  // The server refuses Langy on the demo project outright, so rendering the panel there
  // would only produce a chat where every send 403s. Membership is the permission's to
  // answer: the host carries no member list, and `langy:view` is only held by a member.
  const isDemoProject = !!demoProjectSlug && demoProjectSlug === project?.slug;
  const mayReadLangy = !isDemoProject && traceHost.hasPermission("langy:view");

  // Skip the flag query entirely for callers who are already excluded; the answer is
  // decided without a round-trip.
  const { enabled: releaseLangy, isLoading: flagLoading } = useFeatureFlag(
    FrontendFlags[LANGY_RELEASE_FLAG],
    {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: mayReadLangy,
    },
  );

  // Deliberately never waits on something that may never arrive: a reader with
  // no project at all is DECIDED (they cannot have Langy), not pending. Only
  // the three things that are genuinely in flight count.
  const isResolving =
    sessionStatus === "loading" || traceHost.isLoading() || (mayReadLangy && flagLoading);

  return { show: mayReadLangy && releaseLangy, isResolving };
}

/**
 * The gate as a plain boolean, for the many callers that only hide a control.
 * Reports `false` while the answer is still loading — see {@link LangyVisibility}.
 */
export function useShowLangy(): boolean {
  return useLangyVisibility().show;
}
