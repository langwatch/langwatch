import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { nowInstant } from "@langwatch/time";

import { CODING_AGENT_LINK_WINDOW_DAYS, withinDays } from "../model/coding-agent-activity.ts";
import { useNavigationHost } from "../model/navigation-host.ts";

export interface CodingAgentLinks {
  shouldShowSessions: boolean;
  shouldShowPullRequests: boolean;
}

/**
 * Coding-agent destinations are grown by the project, not configured:
 * each needs its own recent signal, so sessions-only or PR-only both
 * appear alone, and each fades once its signal falls out of the window.
 */
export function useCodingAgentLinks(): CodingAgentLinks {
  const host = useNavigationHost();
  const project = host.project();
  const codingAgentPagesEnabled = host.featureFlag(
    FrontendFlags.release_ui_ai_governance_enabled,
  ).enabled;
  const canSeeCodingAgentActivity = codingAgentPagesEnabled && host.hasPermission("traces:view");
  const now = nowInstant();

  return {
    shouldShowSessions:
      canSeeCodingAgentActivity &&
      withinDays({
        at: project?.lastCodingAgentSessionAt,
        days: CODING_AGENT_LINK_WINDOW_DAYS,
        now,
      }),
    shouldShowPullRequests:
      canSeeCodingAgentActivity &&
      withinDays({
        at: project?.lastCodingAgentPullRequestAt,
        days: CODING_AGENT_LINK_WINDOW_DAYS,
        now,
      }),
  };
}
