import {
  DataRetentionApi,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "@langwatch/data-retention-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { dataRetentionProcessModule } from "../../data-retention.module.ts";
import {
  createDataRetentionTestAuthz,
  createDataRetentionTestEntitlement,
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  createDataRetentionTestUsers,
  retentionTestGraph,
} from "./data-retention.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([dataRetentionProcessModule])
    .withStores(memoryStores())
    .withConfig({
      "data-retention": {
        platformDefaultDays: undefined,
        isSaas: true,
        nodeEnvironment: undefined,
      },
    })
    .provide({
      project: createDataRetentionTestProjects(),
      organization: createDataRetentionTestOrganizations(),
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

      await expect(
        app.getResolvedForProject({ projectId: retentionTestGraph.projectId }),
      ).resolves.toEqual({
        traces: PLATFORM_DEFAULT_RETENTION_DAYS,
        scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
        experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
      });

      await expect(app.listByProject({ projectId: retentionTestGraph.projectId })).resolves.toEqual(
        [],
      );

      // The settings page's read: its directory comes from the registry, not a member.
      await expect(
        app.getPolicySnapshot({ projectId: retentionTestGraph.projectId, userId: "user-1" }),
      ).resolves.toMatchObject({ projectId: retentionTestGraph.projectId, rules: [] });
    } finally {
      await runtime.stop();
    }
  });
});
