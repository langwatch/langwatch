/**
 * Sends a simulations address to Agent Testing when the project reads it.
 * @see specs/features/agent-testing/page-structure.feature
 */
import { useEffect } from "react";
import { useFeatureFlag } from "../use-feature-flag";
import { useLegacySimulationsPreference } from "./use-legacy-simulations-preference";
import { useOrganizationTeamProject } from "../use-organization-team-project";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { useRouter } from "@langwatch/ui-host/use-router";
import { toAgentTestingAddress } from "./use-suite-routing";

export function useAgentTestingRedirect({
  segments,
}: {
  /** The address segments under `/simulations`. */
  segments: string[];
}): {
  /**
   * True while the interface the project reads is not known yet, and while
   * the redirect is in flight. The v1 page renders nothing in that time, so
   * it never shows for a frame to a reader who is sent away.
   */
  deciding: boolean;
} {
  const router = useRouter();
  const { project, organization, isLoading: orgLoading } = useOrganizationTeamProject();
  const organizationId = organization?.id ?? "";
  const { enabled, isLoading: flagLoading } = useFeatureFlag(
    "release_ui_agent_testing_v2_enabled",
    {
      projectId: project?.id ?? NOT_TARGETED,
      organizationId: organizationId || NOT_TARGETED,
      enabled: !!organizationId,
    },
  );
  // Someone who chose the previous screens on this browser reads this page,
  // whatever the flag says. See the new-simulations callout.
  const legacyPreferred = useLegacySimulationsPreference(project?.id);

  const projectSlug = router.query.project;
  const target =
    enabled && !legacyPreferred && router.isReady && typeof projectSlug === "string"
      ? toAgentTestingAddress({
          projectSlug,
          segments,
          query: router.search,
        })
      : null;

  useEffect(() => {
    if (target) void router.replace(target);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    deciding: orgLoading || (!legacyPreferred && !!organizationId && flagLoading) || !!target,
  };
}
