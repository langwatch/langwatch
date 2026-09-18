/**
 * Whether the Phone number transport option is offered in the voice agent
 * drawer for the current project.
 *
 * Mirrors {@link useVoiceAgentsEnabled}: it reads
 * `release_voice_phone_targets_enabled` with the ids from
 * `useOrganizationTeamProject`, so the drawer gates the option the same way
 * every other flag surface reads its flag. Off until the voice worker that
 * dials phone targets ships (#8014); an existing phone target still renders its
 * fields regardless of this flag, so the gate is on the OPTION only.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

export const VOICE_PHONE_TARGETS_FLAG_KEY =
  "release_voice_phone_targets_enabled" as const;

export function useVoicePhoneTargetsEnabled(): boolean {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const { enabled, isLoading } = useFeatureFlag(VOICE_PHONE_TARGETS_FLAG_KEY, {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: !!organization?.id,
  });

  return !isLoading && enabled;
}
