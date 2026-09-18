import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  DataRetentionApi,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "@langwatch/data-retention-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
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
function analyticalWithoutStore(): ClickHouseQueryClient {
  const client: Partial<ClickHouseQueryClient> = {};
  return new Proxy(client, {
    get(_target, property) {
      throw new Error(`The memory tier must not reach ClickHouse (read "${String(property)}").`);
    },
  }) as ClickHouseQueryClient;
}

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(dataRetentionServer)])
    .withConfig({
      "data-retention": { platformDefaultDays: undefined },
    })
    .withMember("nodeEnvironment", undefined)
    .withAnalytical(analyticalWithoutStore())
    .provide({
      project: createDataRetentionTestProjects(),
      organization: createDataRetentionTestOrganizations(),
      authz: createDataRetentionTestAuthz(),
      user: createDataRetentionTestUsers(),
    });
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
