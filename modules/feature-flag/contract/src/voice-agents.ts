import type { FeatureFlagApi } from "./feature-flag.api.ts";
import { VOICE_AGENTS_FLAG_KEY } from "./voice-agents.message.ts";

/**
 * For server callers; client code imports from `./voice-agents.message`
 * directly.
 */
export { VOICE_AGENTS_DISABLED_MESSAGE } from "./voice-agents.message.ts";

/**
 * Single server-side read of release_voice_agents_enabled flag (AC29);
 * takes collaborators instead of singletons.
 */
export async function isVoiceAgentsEnabledForProject(params: {
  projectId: string;
  featureFlags: FeatureFlagApi;
  /** Pass when already known; resolved from the project when omitted. */
  organizationId?: string;
  resolveOrganizationId?: (projectId: string) => Promise<string | undefined>;
}): Promise<boolean> {
  const organizationId =
    params.organizationId ?? (await params.resolveOrganizationId?.(params.projectId));
  return params.featureFlags.isEnabled(VOICE_AGENTS_FLAG_KEY, {
    kind: "project",
    projectId: params.projectId,
    ...(organizationId === undefined ? {} : { organizationId }),
  });
}
