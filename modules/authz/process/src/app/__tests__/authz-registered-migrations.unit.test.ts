/**
 * @vitest-environment node
 * Authz declares its engine migration as the `authz:engine` tenant step, which ops' pass collects
 * from the installed list rather than asking AuthzApi or importing the process package.
 * Spec: specs/migration/system-migrations-runner.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { isDeclaredMigrationStep, isTenantMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { authzProcessModule } from "../../authz.module.ts";
import { createAuthzTestApp } from "./authz.fixture.ts";

function process() {
  return createApp({ role: "worker" })
    .withModules([authzProcessModule])
    .withConfig({
      authz: {
        epochCacheEnabled: false,
        demoProjectId: undefined,
        demoProjectUserId: undefined,
        demoProjectSlug: undefined,
      },
    })
    .withStores(memoryStores())
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .provide({});
}

describe("authz's declared engine step", () => {
  describe("given a process that installed authz", () => {
    /** @scenario "The authorization engine answers the migration it registers" */
    it("declares the grant import as the authz:engine organization step, after old writers", async () => {
      const runtime = await process().boot();

      try {
        const steps = runtime.migrationSteps(isDeclaredMigrationStep).filter(isTenantMigrationStep);

        expect(steps.map(({ id }) => id)).toEqual(["authz:engine"]);
        expect(steps[0]).toMatchObject({
          tenants: "organization",
          title: "Authorization engine",
          requiresOperatorConfirmation: true,
          needsOldWritersGone: true,
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given an app composed from already-built services", () => {
    /** @scenario "An authorization app composed without its migration refuses to answer one" */
    it("refuses by name rather than declaring an empty step", () => {
      expect(() => createAuthzTestApp().engineMigration()).toThrow(/holds no migration/);
    });
  });
});
