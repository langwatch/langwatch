import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "@langwatch/data-retention-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { dataRetentionServer } from "../../data-retention.server.ts";
import {
  createDataRetentionTestAuthz,
  createDataRetentionTestInfrastructure,
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  createDataRetentionTestUsers,
  retentionTestGraph,
} from "./data-retention.fixture.ts";

function process() {
  return createApp({ name: "data-retention-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(ProjectApi, createDataRetentionTestProjects())
    .withProvided(OrganizationApi, createDataRetentionTestOrganizations())
    .withProvided(AuthzApi, createDataRetentionTestAuthz())
    .withProvided(UserApi, createDataRetentionTestUsers())
    .withModule(dataRetentionServer, {
      members: createDataRetentionTestInfrastructure(),
    });
}

describe("data retention app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({
      role,
      config: {
        "data-retention": { platformDefaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS },
      },
    });

    try {
      const app = runtime.service(DataRetentionApi);

      expect(runtime.module(dataRetentionServer).provided).toBe(app);

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
    } finally {
      await runtime.stop();
    }
  });
});
