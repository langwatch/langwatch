import { VOICE_AGENTS_FLAG_KEY } from "./voiceAgents.message.ts";
import type { FeatureFlagApi } from "./feature-flag.api.ts";

/** Client-reachable code must import from `./voiceAgents.message` directly; this re-export is for server callers already importing from this module. */
export { VOICE_AGENTS_DISABLED_MESSAGE } from "./voiceAgents.message.ts";

/**
 * The one server-side read of `release_voice_agents_enabled` (AC29). Every
 * door into voice (tRPC agent writes, /api/voice/*, suite runs) asks this and
 * maps a `false` to its own refusal; the flag key and the targeting shape
 * live only here, mirroring how `langyAccessMiddleware` keeps the Langy gate
 * in one decision.
 *
 * This lives in the contract package, so it takes its collaborators rather
 * than reaching for a process singleton: `featureFlags` is the caller's own
 * resolved `FeatureFlagApi` dependency, and `resolveOrganizationId` is
 * whatever directory lookup the caller already has for its project.
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
