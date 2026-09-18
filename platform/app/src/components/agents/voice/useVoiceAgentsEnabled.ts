import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

/**
 * Single source of truth for whether the voice-agents feature is enabled for
 * the current project/organization. Every voice UI surface gates on this so
 * they flip together (spec: specs/features/agents/voice-agents-v1.feature,
 * AC29). The server enforces the same flag in depth.
 *
 * Loading counts as off: `enabled` is true only once the flag has resolved to
 * on, so a surface is never shown for a frame before the flag settles.
 */
export function useVoiceAgentsEnabled(): { enabled: boolean } {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { enabled, isLoading } = useFeatureFlag("release_voice_agents_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: !!organization?.id,
  });

  return { enabled: !isLoading && enabled };
}
