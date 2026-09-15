/**
 * Feature flag for voice agents; consistent across surfaces.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import {
  NOT_TARGETED,
  VOICE_AGENTS_FLAG_KEY,
} from "@langwatch/feature-flag-contract";
import { useFeatureFlag } from "@langwatch/ui-host/feature-flag";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";

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
