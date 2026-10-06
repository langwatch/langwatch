/**
 * @vitest-environment node
 * The checkup's ClickHouse ping as ops' registries build it: the live one over the
 * routed member, the memory one with no ClickHouse at all.
 * @see modules/ops/specs/ops-store-seams.feature
 */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseClickHouseHealthRepository } from "../clickhouse/clickhouse.datastore-health.repository.ts";
import { MemoryOpsRepositories } from "../memory/memory.ops.repositories.ts";

describe("given ops' ClickHouse health repository", () => {
  describe("when the memory registry built it", () => {
    /** @scenario "The checkup's ClickHouse ping is answered by ops' registry" */
    it("answers the ping with no ClickHouse client composed", async () => {
      await expect(MemoryOpsRepositories.create().clickhouseHealth.ping()).resolves.toBeUndefined();
    });
  });

  describe("when the live registry built it over the routed member", () => {
    /** @scenario "The checkup's ClickHouse ping is answered by ops' registry" */
    it("asks the server one unscoped SELECT 1", async () => {
      const statements: QueryRequest[] = [];
      const clickhouse = clickHouseQueryClientDouble({
        query: async (request: QueryRequest) => {
          statements.push(request);
          return { rows: [] };
        },
      });

      await ClickHouseClickHouseHealthRepository.create({ clickhouse }).ping();

      expect(statements.map((statement) => statement.sql)).toEqual(["SELECT 1"]);
    });
  });
});
