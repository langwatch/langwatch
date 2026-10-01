/**
 * @vitest-environment node
 * AuthzApi answers the migrations authz owns, so the migrations runner composes them through the
 * contract rather than importing the process package.
 * Spec: specs/migration/system-migrations-runner.feature
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { authzServer } from "../../authz.server.ts";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../migrations/legacy-import.authz-grant.migration.ts";
import { createAuthzTestApp } from "./authz.fixture.ts";

function process() {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(authzServer)])
    .withConfig({
      authz: {
        epochCacheEnabled: false,
        demoProjectId: undefined,
        demoProjectUserId: undefined,
        demoProjectSlug: undefined,
      },
    })
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withKeyvalue(redisDouble())
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .provide({});
}

describe("AuthzApi.registeredMigrations", () => {
  describe("given a process that installed authz", () => {
    /** @scenario "The authorization engine answers the migration it registers" */
    it("answers the grant import under its existing name", async () => {
      const runtime = await process().boot();

      try {
        const names = runtime
          .service(AuthzApi)
          .registeredMigrations()
          .map((migration) => migration.name);

        expect(names).toEqual([AUTHZ_ENGINE_MIGRATION_NAME]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given an app composed from already-built services", () => {
    /** @scenario "An authorization app composed without its migration refuses to answer one" */
    it("refuses by name rather than answering an empty registry", () => {
      expect(() => createAuthzTestApp().registeredMigrations()).toThrow(/holds no migration/);
    });
  });
});
