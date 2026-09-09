/**
 * The browser-session service as a feature, so the runtime resolves the cycle:
 * Auth reads the person through `UserApi` and the user application ends their
 * sessions through `AuthApi`. The module ships no installer, so this is here.
 */
import { AuthApi, type AuthService } from "@langwatch/auth-contract";
import { PostgresAuthAdapter } from "@langwatch/auth-server";
import { PostgresIdentityEmailAdapter } from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import { defineModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";

/** What the process holds behind the browser-session service. */
export type ApiAuthSessionInfrastructure = Readonly<{
  prisma: PrismaClient;
  /** Better Auth caches live sessions here, so a revocation clears them too. */
  redis: RedisConnection | null;
}>;

type ApiAuthSessionSetup = FeatureSetup<
  { users: typeof UserApi },
  ApiAuthSessionInfrastructure,
  undefined
>;

/** Auth's contribution to this process, over the runtime's own user peer. */
const apiAuthSessionApp = {
  contract: AuthApi,
  configSchema: undefined,
  dependencies: { users: UserApi },
  create: ({ infrastructure, dependencies }: ApiAuthSessionSetup): AuthService =>
    PostgresAuthAdapter.create({
      database: infrastructure.prisma,
      redis: infrastructure.redis,
      identityEmails: PostgresIdentityEmailAdapter.create({
        database: infrastructure.prisma,
      }).build(),
      users: dependencies.users,
    }).build(),
};

export const apiAuthSessionServer = defineModule("auth").withApp(apiAuthSessionApp).build();
