import { randomUUID } from "node:crypto";

/**
 * Better Auth's storage, built by auth's live repository registry over Postgres and Redis:
 * a session outlives the composition that minted it.
 * @see modules/auth/specs/better-auth-storage-seam.feature
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { instantiateRepositories } from "@langwatch/process";
import { RedisConnectionService, type RedisConnection } from "@langwatch/redis-client";
import { hash } from "bcrypt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authRepositories } from "../../repositories/auth-repositories.registry.ts";
import { providerAccountIssuer } from "../../rules/provider-account-issuer.rules.ts";
import { composedAuth, sessionCookie } from "./support/seam-auth-app.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const REDIS_URL = process.env.LANGWATCH_TEST_REDIS_URL;
const ns = `authseam-${randomUUID().slice(0, 8)}`;
const PERSON = { email: `${ns}@company.test`, password: "correct-horse-battery" };
const IDENTITY_ENCRYPTION = {
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
};

const prisma = PrismaConnectionService.create({
  guard: PrismaTenancyGuardService.create(),
  logger: createLogger("langwatch:auth:test:storage-seam"),
}).connect(
  PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
).client;

/** Auth composed over the live tier its registry builds, on the stores this test opened. */
async function liveTier(redis: RedisConnection | null) {
  const members = { prisma, redis, rateLimiter: {}, encryption: IDENTITY_ENCRYPTION };
  const repositories = instantiateRepositories(authRepositories, { tier: "live", members });
  return composedAuth({ repositories, members });
}

describe.skipIf(!DB_URL)("Better Auth's storage on the live tier", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: ns } } });
    await prisma.$disconnect();
  });

  /** @scenario "The live adapter declares native transactions to single sign-on" */
  it("hands Better Auth a storage that declares native transaction support", async () => {
    const { transport } = await liveTier(null);
    const context = await transport.$context;

    expect(typeof context.adapter.options?.adapterConfig.transaction).toBe("function");
  });

  describe.skipIf(!REDIS_URL)("given a user who has signed in with email and password", () => {
    let redis: RedisConnection;

    beforeAll(async () => {
      redis = new RedisConnectionService().connect({
        url: REDIS_URL,
        clusterEndpoints: undefined,
        dbIndex: undefined,
      })!;
      const user = await prisma.user.create({
        data: { email: PERSON.email, name: "Dana", emailVerified: true },
      });
      await prisma.account.create({
        data: {
          userId: user.id,
          type: "credential",
          provider: "credential",
          providerAccountId: user.id,
          issuer: providerAccountIssuer({ connectionIssuer: undefined, provider: "credential" }),
          password: await hash(PERSON.password, 4),
        },
      });
    });
    afterAll(async () => {
      await redis?.quit();
    });

    /** @scenario "A browser session survives a restart over the registry-built adapter" */
    it("reads the first sign-in's session after auth is composed again over the same stores", async () => {
      const first = await liveTier(redis);
      const signedIn = await first.call("/sign-in/email", { body: PERSON });
      expect(signedIn.status).toBe(200);

      const restarted = await liveTier(redis);
      const session = await restarted.call("/get-session", { cookie: sessionCookie(signedIn) });
      const body = (await session.json()) as { user: { email: string } } | null;

      expect(body?.user.email).toBe(PERSON.email);
    });
  });
});
