/**
 * Trace's read of instant-eval's shared `instant_eval_runs`.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceInstantEvalRunsRepository } from "../trace-instant-eval-runs.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function repositoryOver(rows: unknown[] = []) {
  const reads: ReadRequest[] = [];
  const repository = ClickHouseTraceInstantEvalRunsRepository.create({
    reader: clickHouseQueryClientDouble({
      read: async (request: ReadRequest) => {
        reads.push(request);
        return { rows };
      },
    }),
  });
  return { repository, reads };
}

describe("given the runs an Explorer read's chips claim", () => {
  describe("when trace reads them from instant-eval's table", () => {
    it("reads the latest version of each named run inside the project", async () => {
      const { repository, reads } = repositoryOver([]);

      await repository.findRunsByIds({ projectId: "project-1", runIds: ["run-1", "run-1"] });

      const request = reads[0];
      expect(request?.table).toBe("instant_eval_runs");
      expect(request?.statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        settings: { SQL_langwatch_tenant_ids: "project-1" },
      });
      expect(request?.statement.sql).toContain("max(tuple(WrittenAt, ifNull(AcceptedAt");
      expect(request?.statement.sql).toContain("LIMIT 1 BY RunId");
      expect(Object.values(request?.statement.params ?? {})).toContainEqual(["run-1"]);
    });

    it("maps a run still judging to no finish", async () => {
      const { repository } = repositoryOver([
        { RunId: "run-1", CreatedAtMs: "1758189600000", FinishedAtMs: "1758193200000" },
        { RunId: "run-2", CreatedAtMs: 1758189600000, FinishedAtMs: null },
      ]);

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
      const { repository, reads } = repositoryOver([]);

      expect(await repository.findRunsByIds({ projectId: "project-1", runIds: [] })).toEqual([]);
      expect(reads).toEqual([]);
    });
  });
});
