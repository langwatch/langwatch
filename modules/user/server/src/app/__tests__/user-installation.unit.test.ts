import { AuthApi } from "@langwatch/auth-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { userServer } from "../../user.server.ts";
import {
  createUserTestAuth,
  createUserTestInfrastructure,
  createUserTestOps,
  createUserTestOrganizations,
} from "./user.fixture.ts";

function process() {
  return createApp({ name: "user-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(AuthApi, createUserTestAuth())
    .withProvided(OrganizationApi, createUserTestOrganizations())
    .withProvided(OpsApi, createUserTestOps())
    .withFeature(userServer, { infrastructure: createUserTestInfrastructure() });
}

describe("user app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(UserApi);
      expect(runtime.feature(userServer).provided).toBe(app);

      const created = await app.createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
      });

      await expect(app.tryFindById({ id: created.id })).resolves.toMatchObject({
        email: "ada@example.com",
      });
      await expect(app.hasPassword({ id: created.id })).resolves.toBe(true);
    } finally {
      await runtime.stop();
    }
  });

  it("rotates a password through the credential repository the installer selected", async () => {
    const runtime = await process().boot({ role: "api" });

    try {
      const app = runtime.service(UserApi);
      const created = await app.createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
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
    const first = await process().boot({ role: "api" });
    const second = await process().boot({ role: "api" });

    try {
      const created = await first.service(UserApi).createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hashed:first",
      });

      await expect(second.service(UserApi).tryFindById({ id: created.id })).resolves.toBeNull();
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});
