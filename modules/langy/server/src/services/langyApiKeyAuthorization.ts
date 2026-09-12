/**
 * The one authorization chain behind every key-authed Langy request.
 *
 * Shared by the turn routes in `routes/langy-api.ts` and the health probe in
 * `routes/health-checks.ts`, so a monitor and a client are refused, darkened
 * and bridged to an actor by the same code in the same order: credential,
 * surface flag, `langy:create` ceiling, cohort, actor session.
 *
 * Transport-free apart from a header reader, mirroring the health probes'
 * own `authenticateProject`: the caller decides how a refusal is serialised.
 */

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

/**
 * Names, for the route registry, what a handler-managed Langy route does
 * with the key before any handler code runs.
 */
export const LANGY_API_KEY_AUTH_REASON =
  "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling, then bridged to an owning user by resolveLangyKeyIdentity";

/**
 * Authenticate, open the flag, enforce the ceiling, and bridge to an actor.
 *
 * Throws on every refusal EXCEPT the dark surface, which returns `{ dark: true }`
 * for the caller to answer — see the flag check below for why that one cannot
 * throw. `enforceApiKeyCeiling` already throws a `HandledError`
 * (`ApiKeyPermissionDeniedError`), so the ceiling denial needs no translation
 * here at all — catching it only to re-serialise it was how the code, the
 * permission in `meta` and the tips got dropped.
 */
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

  // Dark surface ⇒ 404, not 403: rollback should look like the route was never
  // deployed, so a client retries nothing and no one reads a denial as a
  // permissions bug.
  //
  // This sits BEFORE the ceiling on purpose. Behind it, a key without
  // `langy:create` got a 403 while the flag was off — a refusal no unmounted
  // route can produce, which told the caller the surface was there.
  //
  // It also cannot THROW, unlike every other refusal in this function. Anything
  // thrown here reaches the app's `onError` and comes back as a JSON envelope;
  // a path that was never mounted falls to Hono's default handler and comes
  // back as plain-text `404 Not Found`. Content-Type and body would differ,
  // and that difference is the leak this 404 exists to prevent. So the caller
  // answers with `c.notFound()`, which IS that default handler — no router in
  // the chain overrides it.
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
