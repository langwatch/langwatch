/**
 * The run row's read and its two shapes: the tenant leads every predicate,
 * the latest version wins, and a row survives the round trip.
 * @see dev/docs/best_practices/clickhouse-queries.md
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import {
  INSTANT_EVAL_RUNS_TABLE,
  type InstantEvalRunNarrowing,
  latestRowsQuery,
  toRow,
  toWriteRecord,
} from "../clickhouse/clickhouse.instant-eval-run.mapper.ts";

const byRunId: InstantEvalRunNarrowing = (column) => `${column("RunId")} = {runId:String}`;

describe("given the read that collapses a run's versions", () => {
  describe("when it is built", () => {
    it("filters the tenant first, in the outer read and in the inner max", () => {
      const sql = latestRowsQuery({ narrowings: [byRunId] });

      const [outer, inner] = sql.split("SELECT TenantId, RunId, max(");

      expect(outer).toContain("WHERE t.TenantId = {tenantId:String}");
      expect(inner).toContain("WHERE TenantId = {tenantId:String}");
      expect(sql).toContain(`FROM ${INSTANT_EVAL_RUNS_TABLE}`);
    });

    it("dedups by the IN-tuple pattern rather than by LIMIT 1 BY", () => {
      const sql = latestRowsQuery({ narrowings: [] });

      expect(sql).toContain("GROUP BY TenantId, RunId");
      expect(sql).toContain(
        "max((WrittenAt, ifNull(AcceptedAt, toDateTime64(0, 3)), LastEventId))",
      );
      expect(sql).not.toContain("LIMIT 1 BY");
    });

    it("narrows both halves, so a page never dedups rows it is about to discard", () => {
      const sql = latestRowsQuery({ narrowings: [byRunId] });

      expect(sql).toContain("AND t.RunId = {runId:String}");
      expect(sql).toContain("AND RunId = {runId:String}");
    });
  });
});

describe("given a run row written and read back", () => {
  describe("when it goes through both mappers", () => {
    it("comes back as the row that was written", () => {
      const row = instantEvalRunRow({
        parameters: { period: "7d" },
        questions: [{ id: "annoyed", kind: "boolean" }],
        plan: [{ column: "annoyed", function: "eval" }],
      });
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      const read = toRow({
        ...written,
        Name: written.Name,
        CreatedAt: written.CreatedAt.getTime(),
        UpdatedAt: written.UpdatedAt.getTime(),
        StartedAt: written.StartedAt?.getTime() ?? null,
        FinishedAt: written.FinishedAt?.getTime() ?? null,
        OccurredAt: written.OccurredAt?.getTime() ?? null,
        AcceptedAt: written.AcceptedAt?.getTime() ?? null,
      });

      expect(read).toEqual(row);
    });

    it("writes the checkpoint columns as empty rather than null, and reads them back as none", () => {
      const row = instantEvalRunRow({ lastEventId: null, projectionVersion: null });
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      expect(written.LastEventId).toBe("");
      expect(written.ProjectionVersion).toBe("");
      expect(
        toRow({
          ...written,
          CreatedAt: written.CreatedAt.getTime(),
          UpdatedAt: written.UpdatedAt.getTime(),
          StartedAt: null,
          FinishedAt: null,
          OccurredAt: null,
          AcceptedAt: null,
        }).lastEventId,
      ).toBeNull();
    });

    it("reads a status the table does not know as queued rather than trusting it", () => {
      const row = instantEvalRunRow();
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      const read = toRow({
        ...written,
        Status: "HALTED",
        Parameters: "not json",
        CreatedAt: written.CreatedAt.getTime(),
        UpdatedAt: written.UpdatedAt.getTime(),
        StartedAt: null,
        FinishedAt: null,
        OccurredAt: null,
        AcceptedAt: null,
      });

      expect(read.status).toBe("QUEUED");
      expect(read.parameters).toEqual({});
    });

    it("keeps the instants the driver answers as strings", () => {
      const row = instantEvalRunRow();
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      const read = toRow({
        ...written,
        CreatedAt: String(written.CreatedAt.getTime()),
        UpdatedAt: String(written.UpdatedAt.getTime()),
        StartedAt: null,
        FinishedAt: null,
        OccurredAt: null,
        AcceptedAt: null,
      });

      expect(Temporal.Instant.compare(read.createdAt, row.createdAt)).toBe(0);
    });
  });
});
