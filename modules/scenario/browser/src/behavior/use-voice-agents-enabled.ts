/**
 * Whether voice agents are turned on for the reader's project. Wraps the
 * release flag with `useOrganizationTeamProject`'s ids; false while either
 * is still arriving, so nothing flashes on before the flag resolves.
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags, NOT_TARGETED } from "@langwatch/feature-flag-contract";

/** The flag every voice surface reads. */
export const VOICE_AGENTS_FLAG_KEY = "release_voice_agents_enabled";

export function useVoiceAgentsEnabled(): boolean {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { enabled, isLoading } = useFeatureFlag(FrontendFlags[VOICE_AGENTS_FLAG_KEY], {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id ?? NOT_TARGETED,
    enabled: !!organization?.id,
  });

  return !isLoading && enabled;
}
