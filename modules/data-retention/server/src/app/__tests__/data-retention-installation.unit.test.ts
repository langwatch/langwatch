import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "@langwatch/data-retention-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { dataRetentionServer } from "../../data-retention.server.ts";
import {
  createDataRetentionTestAuthz,
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  createDataRetentionTestUsers,
  retentionTestGraph,
} from "./data-retention.fixture.ts";

/**
 * The one member `DataRetentionApp` reads (`reads("clickhouse")`). Memory-tier
 * installation never reaches a store, so the boot only needs the member to
 * EXIST — a stub that refuses on use proves that without opening a client.
 */
function membersWithoutStores() {
  return {
    order: ["clickhouse"] as const,
    read(name: string): unknown {
      if (name !== "clickhouse") {
        throw new Error(`This process opened no clients, so it cannot read the "${name}" member.`);
      }

      // Boot builds every claimed member eagerly, so this has to BE something.
      // It refuses on first use instead, which keeps "the memory tier reached
      // ClickHouse" a named failure rather than a silent query.
      return new Proxy(
        {},
        {
          get(_target, property) {
            throw new Error(
              `The memory tier must not reach ClickHouse (read "${String(property)}").`,
            );
          },
        },
      );
    },
    async close() {},
  };
}

function process(role: "api" | "worker") {
  return createApp({
    role,
    config: {
      "data-retention": { platformDefaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS },
    },
    members: membersWithoutStores() as never,
  })
    .withProvided(ProjectApi, createDataRetentionTestProjects())
    .withProvided(OrganizationApi, createDataRetentionTestOrganizations())
    .withProvided(AuthzApi, createDataRetentionTestAuthz())
    .withProvided(UserApi, createDataRetentionTestUsers())
    .withModules([withMemoryRepositories(dataRetentionServer)]);
}

describe("data retention app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

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
