import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClickhouseExperimentClickHouseRepository } from "../clickhouse.experiment-clickhouse.repository.ts";
import { ClickHouseExperimentIdLookupRepository } from "../clickhouse.experiment-id-lookup.repository.ts";

describe("ClickHouseExperimentIdLookupRepository", () => {
  const resolveClient = vi.fn();
  const mockRead = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resolveClient.mockResolvedValue({ read: mockRead });
  });

  describe("given a run with a matching row", () => {
    describe("when the experiment id is looked up", () => {
      it("returns the row's ExperimentId", async () => {
        mockRead.mockResolvedValue({ rows: [{ ExperimentId: "exp-1" }] });
        const repository = ClickHouseExperimentIdLookupRepository.create({
          clickhouse: ClickhouseExperimentClickHouseRepository.create(resolveClient),
        });

        const result = await repository.findExperimentId({
          tenantId: "tenant-1",
          runId: "run-1",
        });

        expect(result).toBe("exp-1");
        expect(resolveClient).toHaveBeenCalledWith("tenant-1");
        const { statement, idBound } = mockRead.mock.calls[0]![0] as {
          statement: ReaderReadStatement;
          idBound: unknown;
        };
        expect(statement).toMatchObject({
          identity: "reader",
          kind: "tenant",
          tenantId: "tenant-1",
        });
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "tenant-1" });
        expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
        expect(statement.sql).toContain("{{idBound:experiment_runs.RunId:");
        expect(Object.values(statement.params)).toContain("run-1");
        expect(idBound).toEqual({ fallback: "unbounded" });
      });
    });
  });

  describe("given no matching row", () => {
    describe("when the experiment id is looked up", () => {
      it("returns null", async () => {
        mockRead.mockResolvedValue({ rows: [] });
        const repository = ClickHouseExperimentIdLookupRepository.create({
          clickhouse: ClickhouseExperimentClickHouseRepository.create(resolveClient),
        });

        const result = await repository.findExperimentId({
          tenantId: "tenant-1",
          runId: "run-1",
        });

        expect(result).toBeNull();
      });
    });
  });
});
