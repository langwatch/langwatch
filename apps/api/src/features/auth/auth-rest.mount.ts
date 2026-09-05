/**
 * The API process's `/api/auth` door.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthService } from "@langwatch/auth-contract";
import { PostgresAuthDirectoryAdapter, type AuthRestPorts } from "@langwatch/auth-server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { runWithIdentityBirth } from "@langwatch/identity-server/adapters/better-auth-identity-birth";
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
    directory: () => PostgresAuthDirectoryAdapter.create({ database: prisma }),
    baseUrl: betterAuth.baseUrl,
    federatedLogout: () => Promise.resolve(null),
    runWithIdentityBirth,
  };
}
