import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DataRetentionApi,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "@langwatch/data-retention-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { dataRetentionProcessModule } from "../../data-retention.module.ts";
import {
  createDataRetentionTestAuthz,
  createDataRetentionTestEntitlement,
  createDataRetentionTestUsers,
  retentionTestGraph,
} from "./data-retention.fixture.ts";

function process(
  role: "api" | "worker",
  config: { platformDefaultDays?: string; nodeEnvironment?: string } = {},
) {
  return createApp({ role })
    .withModules([dataRetentionProcessModule])
    .withStores(memoryStores())
    .withConfig({
      "data-retention": {
        platformDefaultDays: config.platformDefaultDays,
        isSaas: true,
        nodeEnvironment: config.nodeEnvironment,
      },
    })
    .provide({
      authz: createDataRetentionTestAuthz(),
      user: createDataRetentionTestUsers(),
      entitlement: createDataRetentionTestEntitlement(),
    });
}

describe("data retention app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(DataRetentionApi);

      expect(runtime.module(dataRetentionProcessModule).provided).toBe(app);

      // The memory placement reader starts empty: a project with no row is refused, not defaulted.
      await expect(
        app.getResolvedForProject({ projectId: retentionTestGraph.projectId }),
      ).rejects.toMatchObject({ code: "project_not_found" });
      expect(app.getPlatformDefaultRetentionDays()).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);

      await expect(app.listByProject({ projectId: retentionTestGraph.projectId })).resolves.toEqual(
        [],
      );

      // The settings page's read resolves through the same reader, so it refuses the same way.
      await expect(
        app.getPolicySnapshot({ projectId: retentionTestGraph.projectId, userId: "user-1" }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    } finally {
      await runtime.stop();
    }
  });

  describe("when a worker installs data retention", () => {
    /** @scenario "Data retention installs no project-scope fold and no replay step" */
    it("hosts no project-scope pipeline and collects no project-scope replay step", async () => {
      const runtime = await process("worker").boot();

      try {
        const steps = runtime.migrationSteps(isMigrationStep).map(({ id }) => id);

        expect(steps).not.toContain("data-retention:replay-project-scope");
        expect(dataRetentionProcessModule.eventing?.pipeline).toContain(
          "data_retention_seat_policy",
        );
        expect(dataRetentionProcessModule.eventing?.pipeline).not.toContain(
          "data_retention_project_scope",
        );
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when boot validates a platform default named in its configuration", () => {
    /** @scenario "Boot supplies the platform default" */
    it("resolves a scope with no rule to that default, with the contract reading no environment", async () => {
      const runtime = await process("api", {
        platformDefaultDays: "7",
        nodeEnvironment: "test",
      }).boot();

      try {
        await expect(
          runtime.service(DataRetentionApi).previewScopeRemoval({
            organizationId: retentionTestGraph.organizationId ?? "",
            scope: { scopeType: "ORGANIZATION", scopeId: retentionTestGraph.organizationId ?? "" },
            userId: "user-1",
          }),
        ).resolves.toEqual({ traces: 7, scenarios: 7, experiments: 7 });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the contract is imported", () => {
    /** @scenario "Boot supplies the platform default" */
    it("holds no read of the process environment", () => {
      const contractSrc = join(import.meta.dirname, "..", "..", "..", "..", "contract", "src");
      const readers = readdirSync(contractSrc)
        .filter((file) => file.endsWith(".ts"))
        .filter((file) =>
          readFileSync(join(contractSrc, file), "utf8")
            .split("\n")
            .some((line) => !/^\s*(\/\/|\/?\*)/.test(line) && /process\.env\b/.test(line)),
        );

      expect(readers).toEqual([]);
    });
  });
});
