import { featureFlagService } from "~/server/featureFlag";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { VOICE_AGENTS_FLAG_KEY } from "./voiceAgents.message";

/** Client-reachable code must import from `./voiceAgents.message` directly; this re-export is for server callers already importing from this module. */
export { VOICE_AGENTS_DISABLED_MESSAGE } from "./voiceAgents.message";

/**
 * The one server-side read of `release_voice_agents_enabled` (AC29). Every
 * door into voice (tRPC agent writes, /api/voice/*, suite runs) asks this and
 * maps a `false` to its own refusal; the flag key and the targeting shape
 * live only here, mirroring how `langyAccessMiddleware` keeps the Langy gate
 * in one decision.
 */
export async function isVoiceAgentsEnabledForProject(params: {
  projectId: string;
  /** Pass when already known; resolved from the project when omitted. */
  organizationId?: string;
}): Promise<boolean> {
  const organizationId =
    params.organizationId ??
    (await resolveOrganizationId(params.projectId)) ??
    NOT_TARGETED;
  return featureFlagService.isEnabled(VOICE_AGENTS_FLAG_KEY, {
    distinctId: params.projectId,
    projectId: params.projectId,
    organizationId,
  });
}
