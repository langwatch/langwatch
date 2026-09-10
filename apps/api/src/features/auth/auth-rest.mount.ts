/**
 * The API process's `/api/auth` door.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import {
  authRest,
  PrismaAuthDirectoryRepository,
  type AuthDoorApi,
} from "@langwatch/auth-server";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { BetterAuthIdentityBirthAdapter } from "@langwatch/identity-server/adapters/better-auth-identity-birth";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { MountableRestApp, RestErrorHandler } from "@langwatch/api/rest";

import type {
  ApiBrowserSessionTransport,
  ApiComposedBetterAuth,
} from "../../app/api-auth.composition.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export type ApiAuthRestOptions = Readonly<{
  /** The instance this process composed, or none where a host supplied one. */
  betterAuth: ApiComposedBetterAuth | undefined;
  /** The SAME transport every other door verifies a cookie through. */
  sessions: ApiBrowserSessionTransport | undefined;
  /** The Auth service a logout revokes the browser session on. */
  auth: AuthApi | undefined;
  /** The SAME credential service the legacy token check resolves through. */
  apiKeys: ApiKeyApi | undefined;
  /** The process's one guarded connection, or none. */
  prisma: PrismaClient | undefined;
  /** This deployment's flag store, for the born-finalized entrance. */
  featureFlags: FeatureFlagApi | undefined;
}>;

/**
 * Mounts `/api/auth` on the public door. The catch-all is what Better Auth
 * manages its own session behind, so the family answers its refusals in this
 * process's legacy envelope, exactly as it always has.
 */
export function mountAuthRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ door: () => AuthDoorApi; errors: RestErrorHandler }>,
): MountableRestApp {
  return runtime.mount(authRest.router(), options.door, { onError: options.errors });
}

/** Composes the `/api/auth` family's ports, or none. */
export function composeApiAuthRest(options: ApiAuthRestOptions): AuthDoorApi | undefined {
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
    findProjectSlugByToken: async ({ token }) => {
      const resolved = await apiKeys.findResolvedToken({ token });
      return resolved?.project.slug ?? null;
    },
    featureFlags: () => featureFlags,
    directory: () => PrismaAuthDirectoryRepository.create(prisma),
    baseUrl: betterAuth.baseUrl,
    federatedLogout: () => Promise.resolve(null),
    runWithIdentityBirth: BetterAuthIdentityBirthAdapter.runWithIdentityBirth,
  };
}
