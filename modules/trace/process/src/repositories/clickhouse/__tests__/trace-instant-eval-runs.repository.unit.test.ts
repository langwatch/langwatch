/**
 * Trace's read of instant-eval's shared `instant_eval_runs`.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseTraceInstantEvalRunsRepository } from "../trace-instant-eval-runs.repository.ts";

type ChQuery = { query: string; query_params?: Record<string, unknown> };

function client(rows: unknown[] = []) {
  const query = vi.fn(async (_request: ChQuery) => ({ json: async () => rows }));
  return { query, insert: vi.fn() };
}

describe("given the runs an Explorer read's chips claim", () => {
  describe("when trace reads them from instant-eval's table", () => {
    it("reads the latest version of each named run inside the project", async () => {
      const ch = client([]);
      const repository = ClickHouseTraceInstantEvalRunsRepository.create({
        resolveClient: async () => ch as never,
      });

      await repository.findRunsByIds({ projectId: "project-1", runIds: ["run-1", "run-1"] });

      const request = ch.query.mock.calls[0]?.[0];
      expect(request?.query).toContain("FROM instant_eval_runs AS t");
      expect(request?.query).toContain("max((WrittenAt, ifNull(AcceptedAt");
      expect(request?.query_params).toEqual({ tenantId: "project-1", runIds: ["run-1"] });
    });

    it("maps a run still judging to no finish", async () => {
      const ch = client([
        { RunId: "run-1", CreatedAt: "1758189600000", FinishedAt: "1758193200000" },
        { RunId: "run-2", CreatedAt: 1758189600000, FinishedAt: null },
      ]);
      const repository = ClickHouseTraceInstantEvalRunsRepository.create({
        resolveClient: async () => ch as never,
      });

      const rows = await repository.findRunsByIds({
        projectId: "project-1",
        runIds: ["run-1", "run-2"],
      });

      expect(rows.map((row) => [row.runId, row.finishedAt?.epochMilliseconds ?? null])).toEqual([
        ["run-1", 1758193200000],
        ["run-2", null],
      ]);
      expect(rows[1]?.createdAt.epochMilliseconds).toBe(1758189600000);
    });

    it("asks nothing when no run is named", async () => {
      const ch = client([]);
      const repository = ClickHouseTraceInstantEvalRunsRepository.create({
        resolveClient: async () => ch as never,
      });

      expect(await repository.findRunsByIds({ projectId: "project-1", runIds: [] })).toEqual([]);
      expect(ch.query).not.toHaveBeenCalled();
    });
  });
});
