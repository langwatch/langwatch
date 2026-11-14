/**
 * The materialisation steps' built system.mutations reads, run on a migrated 26.8 server on the
 * system identity: the server accepts each, and a started materialisation is found by its command.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { beforeAll, describe, expect, it } from "vitest";

import { ANALYTICS_METADATA_COLUMNS } from "../../trace-index-materialisation.repository.ts";
import { ClickHouseTraceIndexMaterialisationRepository } from "../clickhouse.trace-index-materialisation.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repository: ClickHouseTraceIndexMaterialisationRepository;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repository = ClickHouseTraceIndexMaterialisationRepository.create(traceQueryClientFor(ch));
}, 120_000);

describe.skipIf(!clickHouseConfigured)("trace index materialisation on live ClickHouse", () => {
  describe("when the updated-at index materialisation has been started", () => {
    it("finds the mutation by its command on the system identity", async () => {
      await repository.materialiseUpdatedAtIndex();

      const mutations = await repository.findUpdatedAtIndexMutations();

      expect(mutations.length).toBeGreaterThan(0);
      expect(mutations[0]).toMatchObject({ mutationId: expect.any(String) });
    });
  });

  describe("when the analytics metadata columns' mutations are read", () => {
    // 26.8 records one mutation per MATERIALIZE COLUMN, so main's whole-name match may find none.
    it("matches the same mutations as main's text, and the server accepts the parts count", async () => {
      await repository.materialiseAnalyticsMetadataColumns();

      const mutations = await repository.findAnalyticsMetadataColumnMutations();
      const main = await ch.query({
        query: `SELECT mutation_id FROM system.mutations
          WHERE database = currentDatabase() AND table = 'trace_analytics'
            AND hasAll(extractAll(command, 'MATERIALIZE COLUMN ([A-Za-z0-9_]+)'), {columns:Array(String)})`,
        query_params: { columns: [...ANALYTICS_METADATA_COLUMNS] },
        format: "JSONEachRow",
      });
      const missing = await repository.countPartsMissingAnalyticsMetadataColumns();

      expect(mutations.map(({ mutationId }) => mutationId).toSorted()).toEqual(
        (await main.json<{ mutation_id: string }>())
          .map(({ mutation_id }) => mutation_id)
          .toSorted(),
      );
      expect(missing).toBeGreaterThanOrEqual(0);
    });
  });
});
