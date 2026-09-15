/**
 * Feature flag for voice agents; consistent across surfaces.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { VOICE_AGENTS_FLAG_KEY } from "@langwatch/feature-flag-contract";

export function useVoiceAgentsEnabled(): boolean {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { enabled, isLoading } = useFeatureFlag(VOICE_AGENTS_FLAG_KEY, {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: !!organization?.id,
  });

  return !isLoading && enabled;
}
