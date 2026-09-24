import { createApiFixture } from "@langwatch/api-fixture";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { UserApi } from "@langwatch/user-contract";
import { hash } from "bcrypt";
import { describe, expect, it } from "vitest";

import { userServer } from "../../user.server.ts";
import {
  createUserTestAuth,
  createUserTestOps,
  createUserTestOrganizations,
} from "./user.fixture.ts";

/**
 * The narrow slice of a generated Prisma client the organization directory
 * reads, faked so the installation test can boot `UserApp` without a real
 * database; every read here answers "not found".
 */
function fakeUserPrisma(): PrismaClient {
  return prismaDouble({
    organizationUser: { findFirst: async () => null },
    organization: { findUnique: async () => null },
    project: { findFirst: async () => null },
  });
}

/** The fixed-window counter's own three calls, faked to always allow. */
function fakeUserRedis(): RedisConnection {
  return redisDouble({ incr: async () => 1, expire: async () => 1, ttl: async () => -1 });
}

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(userServer)])
    .withMembers({ passkeysEnabled: false, publicBaseUrl: undefined })
    .withRelational(fakeUserPrisma())
    .withKeyvalue(fakeUserRedis())
    .provide({
      auth: createUserTestAuth(),
      identity: createApiFixture<IdentityApi>(),
      organization: createUserTestOrganizations(),
      ops: createUserTestOps(),
      project: createApiFixture<ProjectApi>(),
    });
}

describe("user app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(UserApi);
      expect(runtime.module(userServer).provided).toBe(app);

      const created = await app.createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
      });

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        email: "ada@example.com",
      });
      await expect(app.hasPassword({ id: created.id })).resolves.toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  it("rotates a password through the credential repository the installer selected", async () => {
    const runtime = await process("api").boot();

    try {
      const app = runtime.service(UserApi);
      // The real bcrypt hasher this app builds from its own reads, not a
      // fake one: a rotation must verify against the SAME stored format the
      // credential row was minted with.
      const created = await app.createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: await hash("first", 10),
      });

      await expect(
        app.rotatePassword({
          userId: created.id,
          currentPassword: "first",
          newPassword: "second",
        }),
      ).resolves.toBe("rotated");
      await expect(
        app.rotatePassword({
          userId: created.id,
          currentPassword: "first",
          newPassword: "third",
        }),
      ).resolves.toBe("wrong_password");
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      const created = await first.service(UserApi).createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
      });

      await expect(second.service(UserApi).findById({ id: created.id })).resolves.toBeNull();
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});
