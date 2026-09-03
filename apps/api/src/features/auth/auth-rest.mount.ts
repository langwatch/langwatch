/**
 * The API process's `/api/auth` door.
 *
 * Behaviour is package-owned (`@langwatch/auth-server`); this supplies the
 * eight things the family reaches that Auth does not own, and every one of
 * them is TAKEN from a half this process already composed — the Better Auth
 * instance the session transport reads, the Auth service the tRPC boundary
 * revokes through, the credential service every other door resolves a token
 * on, and the flag store and typed client the born-finalized entrance decides
 * per organization from. A second of any of them would let sign-in and every
 * other door disagree about one person.
 *
 * ## What makes the family absent
 *
 * No composed Better Auth instance, no database, no credential service or no
 * flag store. The first is the sharp one: where a host supplied its own
 * transport this process holds no instance and none of its options, and an
 * instance built here from a different option set would not fail — it would
 * verify nothing and answer "signed out" to everybody.
 *
 * NAMED ABSENCE: no federated logout. This process mounts no social or generic
 * OIDC provider at all (see `composeApiBetterAuth`), so there is no identity
 * provider session for a logout to end, and `null` — the local redirect to
 * `/auth/signin` — is the whole truth rather than a stub for one.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthService } from "@langwatch/auth-contract";
import type { AuthRestPorts } from "@langwatch/auth-server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  ApiBrowserSessionTransportPort,
  ApiComposedBetterAuth,
} from "../../app/api-auth.composition";

export type ApiAuthRestOptions = Readonly<{
  /** The instance this process composed, or none where a host supplied one. */
  betterAuth: ApiComposedBetterAuth | undefined;
  /** The SAME transport every other door verifies a cookie through. */
  sessions: ApiBrowserSessionTransportPort | undefined;
  /** The Auth service a logout revokes the browser session on. */
  auth: AuthService | undefined;
  /** The SAME credential service the legacy token check resolves through. */
  apiKeys: ApiKeyService | undefined;
  /** The process's one guarded connection, or none. */
  prisma: PrismaClient | undefined;
  /** This deployment's flag store, for the born-finalized entrance. */
  featureFlags: FeatureFlagService | undefined;
}>;

/** Composes the `/api/auth` family's ports, or none. */
export function composeApiAuthRest(options: ApiAuthRestOptions): AuthRestPorts | undefined {
  const { betterAuth, sessions, auth, apiKeys, prisma, featureFlags } = options;
  if (!betterAuth || !sessions || !auth || !apiKeys || !prisma || !featureFlags) {
    return undefined;
  }

  return {
    betterAuth: () => betterAuth.transport,
    revokeBrowserSession: (input) => auth.revokeBrowserSession(input),
    resolveSession: async (request) => {
      const verified = await sessions.tryResolveVerifiedSession(request);
      return auth.tryResolveBrowserSession({ verified });
    },
    tryFindProjectSlugByToken: async ({ token }) => {
      const resolved = await apiKeys.tryResolveToken({ token });
      return resolved?.project.slug ?? null;
    },
    featureFlags: () => featureFlags,
    database: () => prisma,
    baseUrl: betterAuth.baseUrl,
    federatedLogout: () => Promise.resolve(null),
  };
}
