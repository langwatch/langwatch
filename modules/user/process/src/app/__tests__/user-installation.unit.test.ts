import type { AuthzApi } from "@langwatch/authz-contract";
import { EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { UserApi } from "@langwatch/user-contract";
import { hash } from "bcrypt";
import { describe, expect, it } from "vitest";

import { userProcessModule } from "../../user.module.ts";
import { createUserTestAuth, createUserTestOrganizations } from "./user.fixture.ts";

function process(
  role: "api" | "worker",
  peers: Readonly<{
    authz?: AuthzApi;
    organization?: OrganizationApi;
  }> = {},
) {
  return createApp({ role })
    .withModules([userProcessModule])
    .withStores(memoryStores())
    .withEventing(
      new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        executionTarget: "api",
        consumersEnabled: false,
        processManagerMode: "producer-only",
      }),
    )
    .withConfig({
      user: {
        publicBaseUrl: undefined,
        passkeysEnabled: false,
        mfaEnrollmentOpen: false,
        localPasswords: false,
      },
    })
    .provide({
      auth: createUserTestAuth(),
      authz: peers.authz ?? createApiFixture<AuthzApi>(),
      notification: createApiFixture<NotificationService>(),
      organization: peers.organization ?? createUserTestOrganizations(),
      "stored-object": createApiFixture<StoredObjectApi>(),
    });
}

describe("user app installation", () => {
  /** @scenario "The seed step records a created fact for every existing account" */
  it("declares the created-fact seed as a background step", async () => {
    const runtime = await process("worker").boot();
    try {
      const step = runtime
        .migrationSteps(isMigrationStep)
        .find(({ id }) => id === "user:record-created-facts");
      expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
    } finally {
      await runtime.stop();
    }
  });

  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(UserApi);
      expect(runtime.module(userProcessModule).provided).toBe(app);

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
