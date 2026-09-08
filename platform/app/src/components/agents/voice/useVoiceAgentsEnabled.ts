/**
 * Whether voice agents are turned on for the current project.
 *
 * Wraps `useFeatureFlag("release_voice_agents_enabled")` with the ids from
 * `useOrganizationTeamProject`, so every voice surface reads the same flag
 * the same way instead of re-deriving projectId/organizationId at each call
 * site. Returns false while the ids or the flag are still loading, so a
 * voice surface never flashes on before the flag resolves.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

export function useVoiceAgentsEnabled(): boolean {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { enabled, isLoading } = useFeatureFlag(
    "release_voice_agents_enabled",
    {
      projectId: project?.id ?? NOT_TARGETED,
      organizationId: organization?.id,
      enabled: !!organization?.id,
    },
  );

  return !isLoading && enabled;
}
