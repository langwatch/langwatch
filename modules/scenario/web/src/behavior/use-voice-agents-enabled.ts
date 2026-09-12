/**
 * Whether voice agents are turned on for the reader's project.
 *
 * Wraps the one release flag with the ids from `useOrganizationTeamProject`,
 * so every voice surface reads it the same way instead of re-deriving the
 * project and organization at each call site. False while the ids or the flag
 * are still arriving, so a voice surface never flashes on before the flag
 * resolves.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { NOT_TARGETED } from "@langwatch/feature-flag-contract";

import { useFeatureFlag } from "./use-feature-flag.ts";
import { useOrganizationTeamProject } from "./use-organization-team-project.ts";

/** The flag every voice surface reads. */
export const VOICE_AGENTS_FLAG_KEY = "release_voice_agents_enabled";

export function useVoiceAgentsEnabled(): boolean {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { enabled, isLoading } = useFeatureFlag(VOICE_AGENTS_FLAG_KEY, {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id ?? NOT_TARGETED,
    enabled: !!organization?.id,
  });

  return !isLoading && enabled;
}
