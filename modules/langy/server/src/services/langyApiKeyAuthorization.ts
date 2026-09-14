/** The authorization chain shared by turn routes and health probes. Refuses, darkens, and
 * bridges to actor in one order: credential, surface flag, langy:create ceiling, cohort, session.
 * Transport-free except header reader (caller decides refusal serialization). */

import {
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import { featureFlagService } from "@langwatch/feature-flag-contract";
import {
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
} from "../../../web/src/behavior/errors.tsx";
import { resolveLangyActorSession } from "./langyApiKeyActorSession";
import { resolveLangyKeyIdentity } from "./langyApiKeyIdentity";

const tokenResolver = TokenResolver.create(prisma);

/** Names for route registry: what a handler-managed route does with the key before handlers run. */
export const LANGY_API_KEY_AUTH_REASON =
  "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling, then bridged to an owning user by resolveLangyKeyIdentity";

/** Authenticate, open flag, enforce ceiling, and bridge to actor. Throws on all refusals EXCEPT
 * dark surface (returns { dark: true }). enforceApiKeyCeiling already throws HandledError. */
export async function authorizeLangyApiKey(c: {
  req: { header(name: string): string | undefined };
}) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) throw new LangyApiCredentialMissingError();

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) throw new LangyApiCredentialInvalidError();

  // Dark surface → 404 (not 403): rollback looks like route never deployed. Before ceiling
  // check to prevent leaking its existence. Cannot throw; returns { dark: true } to caller.
  const surfaceOpen = await featureFlagService.isEnabled(
    "release_langy_api_key_turns_enabled",
    {
      distinctId: resolved.project.id,
      projectId: resolved.project.id,
      organizationId: resolved.project.team.organizationId,
    },
  );
  if (!surfaceOpen) return { dark: true as const };

  await enforceApiKeyCeiling({ resolved, permission: "langy:create" });

  const identity = await resolveLangyKeyIdentity({ resolved });
  if (!identity.ok) {
    throw new LangyApiIdentityDeniedError(
      identity.reason === "unowned"
        ? "langy_api_key_unowned"
        : "langy_api_key_no_langy_access",
      identity.message,
    );
  }

  const actor = await resolveLangyActorSession({
    prisma,
    userId: identity.userId,
    now: new Date(),
  });
  if (!actor.ok) {
    throw new LangyApiIdentityDeniedError(
      "langy_api_actor_missing",
      actor.message,
    );
  }

  return {
    dark: false as const,
    session: actor.session,
    projectId: resolved.project.id,
    markUsed: () => {
      if (resolved.type === "apiKey") {
        tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
      }
    },
  };
}
