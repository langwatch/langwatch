/**
 * The materialisation steps' mutation reads are built on the system identity (ADR-202): a
 * mutation's command names the tenants it rewrites, so no reader may list system.mutations.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ANALYTICS_METADATA_COLUMNS } from "../../trace-index-materialisation.repository.ts";
import { ClickHouseTraceIndexMaterialisationRepository } from "../clickhouse.trace-index-materialisation.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const MUTATION = { mutationId: "m-1", isDone: 0, partsToDo: 3, latestFailReason: "" };

function repositoryOver(reads: ReadRequest[]) {
  return ClickHouseTraceIndexMaterialisationRepository.create(
    clickHouseQueryClientDouble({
      async read(request: ReadRequest) {
        reads.push(request);
        return { rows: [MUTATION] };
      },
    }),
  );
}

describe("ClickHouseTraceIndexMaterialisationRepository", () => {
  describe("when the updated-at index's mutations are read", () => {
    it("reads trace_summaries' index mutations on the system identity, newest first", async () => {
      const reads: ReadRequest[] = [];

      const mutations = await repositoryOver(reads).findUpdatedAtIndexMutations();

      expect(reads[0]?.table).toBe("system.mutations");
      expect(reads[0]?.statement).toMatchObject({ kind: "allTenants", identity: "system" });
      expect(reads[0]?.statement.sql).toMatch(/position\(command, \{v\d+:String\}\) > /);
      expect(reads[0]?.statement.sql).toMatch(/ORDER BY create_time DESC/);
      expect(Object.values(reads[0]?.statement.params ?? {})).toEqual(
        expect.arrayContaining(["trace_summaries", "MATERIALIZE INDEX idx_updated_at"]),
      );
      expect(mutations).toEqual([{ ...MUTATION, isDone: false }]);
    });
  });

  describe("when the analytics metadata columns' mutations are read", () => {
    it("matches every whole column name in the command, bound as one array", async () => {
      const reads: ReadRequest[] = [];

      await repositoryOver(reads).findAnalyticsMetadataColumnMutations();

      expect(reads[0]?.statement).toMatchObject({ kind: "allTenants", identity: "system" });
      expect(reads[0]?.statement.sql).toMatch(/hasAll\(extractAll\(command, \{v\d+:String\}\)/);
      expect(Object.values(reads[0]?.statement.params ?? {})).toEqual(
        expect.arrayContaining(["trace_analytics", [...ANALYTICS_METADATA_COLUMNS]]),
      );
    });
  });

  describe("when the parts lacking the analytics metadata columns are counted", () => {
    it("counts over a derived system.parts_columns read with the column list bound once", async () => {
      const reads: ReadRequest[] = [];
      const repository = ClickHouseTraceIndexMaterialisationRepository.create(
        clickHouseQueryClientDouble({
          async read(request: ReadRequest) {
            reads.push(request);
            return { rows: [{ parts: 2 }] };
          },
        }),
      );

      const parts = await repository.countPartsMissingAnalyticsMetadataColumns();

      expect(parts).toBe(2);
      expect(reads[0]?.table).toBe("system.parts_columns");
      expect(reads[0]?.statement).toMatchObject({ kind: "allTenants", identity: "system" });
      expect(reads[0]?.statement.sql).toMatch(
        /FROM \(SELECT name AS PartName FROM system\.parts_columns/,
      );
      const lists = Object.values(reads[0]?.statement.params ?? {}).filter(Array.isArray);
      expect(lists).toEqual([[...ANALYTICS_METADATA_COLUMNS]]);
    });
  });
});
