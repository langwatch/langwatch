/**
 * A real ClickHouse refusal, read through the analytics session: a statement past its memory
 * cap fails with the handled `query_memory_exceeded`, by the error shape the driver raises.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { ClickHouseAnalyticsSessionsRepository } from "../clickhouse.analytics-sessions.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

function queryClientOver(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("this suite never inserts")),
    command: () => Promise.reject(new Error("this suite never commands")),
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

describe.skipIf(!enabled)("ClickHouseAnalyticsSessionRepository against ClickHouse", () => {
  let sessions: ClickHouseAnalyticsSessionsRepository;

  beforeAll(async () => {
    const { client } = await startMigratedClickHouse();
    sessions = ClickHouseAnalyticsSessionsRepository.create(queryClientOver(client));
  });

  describe("when a read runs past its memory cap", () => {
    it("fails with query_memory_exceeded, status 422 and a customer fault", async () => {
      const session = await sessions.resolve("project-1");

      const read = session.query({
        query: "SELECT groupArray(number) FROM numbers(20000000)",
        query_params: {},
        format: "JSONEachRow",
        clickhouse_settings: { max_memory_usage: "10000000" },
      });

      await expect(read).rejects.toMatchObject({
        code: "query_memory_exceeded",
        httpStatus: 422,
        fault: "customer",
      });
    });
  });
});
