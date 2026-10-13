/** Spec: specs/clickhouse/single-client-access.feature */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const MEMORY_LIMIT_ROW = {
  exception:
    "Code: 241. DB::Exception: (total) memory limit exceeded: would use 12.76 GiB. (MEMORY_LIMIT_EXCEEDED)",
};

const TENANT_READ =
  "SELECT SeriesId, PointId, BucketCounts FROM metric_data_points WHERE TenantId = {tenantId:String}";

/** A server that sends `batches` after its 200, the last ending in whatever the server wrote. */
function routedTo(batches: Record<string, unknown>[][]) {
  const server = {
    query: vi.fn(async (_params: unknown) => ({
      json: async () => batches.flat(),
      stream: async function* () {
        for (const batch of batches) yield batch.map((row) => ({ json: () => row }));
      },
    })),
    insert: vi.fn(async (_params: unknown) => undefined),
    command: vi.fn(async (_params: unknown) => undefined),
    close: vi.fn(async () => undefined),
  };
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => "org-shared" },
    }),
    clientFactory: { create: () => server },
  });
  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
  });
  return { client, connection };
}

const tenantRead = { tenantId: "project-a", sql: TENANT_READ, params: { tenantId: "project-a" } };

describe("routingDriver", () => {
  describe("given a read the server fails after sending its first rows", () => {
    /** @scenario "A read whose body ends in the server's exception fails with the server's code" */
    it("fails the read with the server's code instead of answering the exception as a row", async () => {
      const { client, connection } = routedTo([
        [{ SeriesId: "s1", PointId: "p1", BucketCounts: ["1"] }, MEMORY_LIMIT_ROW],
      ]);

      try {
        await expect(client.query(tenantRead)).rejects.toMatchObject({ code: "241" });
      } finally {
        await connection.closeOnce();
      }
    });

    it("answers a row whose sole column is named exception but is no server failure", async () => {
      const { client, connection } = routedTo([[{ exception: "a user-chosen label" }]]);

      try {
        const result = await client.query(tenantRead);
        expect(result.rows).toEqual([{ exception: "a user-chosen label" }]);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("given a streamed read the server fails after sending its first batch", () => {
    /** @scenario "A streamed read whose last batch ends in the server's exception fails the stream" */
    it("yields the batches before the failure, then fails with the server's code", async () => {
      const { client, connection } = routedTo([
        [{ SeriesId: "s1", PointId: "p1", BucketCounts: ["1"] }],
        [MEMORY_LIMIT_ROW],
      ]);
      const received: unknown[][] = [];

      try {
        await expect(
          (async () => {
            for await (const batch of client.stream(tenantRead)) received.push(batch);
          })(),
        ).rejects.toMatchObject({ code: "241" });
        expect(received).toEqual([[{ SeriesId: "s1", PointId: "p1", BucketCounts: ["1"] }]]);
      } finally {
        await connection.closeOnce();
      }
    });
  });
});
