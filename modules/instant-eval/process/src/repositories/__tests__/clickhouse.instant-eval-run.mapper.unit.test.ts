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
  type InstantEvalRunRecord,
  latestRunsRead,
  toRow,
  toWriteRecord,
} from "../clickhouse/clickhouse.instant-eval-run.mapper.ts";

describe("given the read that collapses a run's versions", () => {
  describe("when it is built", () => {
    it("is a single-tenant reader read with the tenant setting, the tenant in the election too", () => {
      const statement = latestRunsRead({
        projectId: "project-1",
        narrowing: { runId: "run-1" },
        limit: 1,
      });

      expect(statement).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId: "project-1",
      });
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      const [election, outer] = statement.sql.split(") SELECT ");
      expect(election).toContain(
        `FROM ${INSTANT_EVAL_RUNS_TABLE} WHERE TenantId = {tenantId:String}`,
      );
      expect(outer).toContain(`FROM ${INSTANT_EVAL_RUNS_TABLE} WHERE TenantId = {tenantId:String}`);
    });

    it("dedups by the IN-tuple pattern over written, accepted and last event, not by LIMIT 1 BY", () => {
      const { sql } = latestRunsRead({ projectId: "project-1", narrowing: {} });

      expect(sql).toContain("GROUP BY RunId");
      expect(sql).toMatch(
        /max\(tuple\(WrittenAt, ifNull\(AcceptedAt, fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)\), LastEventId\)\)/,
      );
      expect(sql).toContain(") IN latest");
      expect(sql).not.toContain("LIMIT 1 BY");
    });

    it("narrows both halves, so a page never dedups rows it is about to discard", () => {
      const { sql, params } = latestRunsRead({
        projectId: "project-1",
        narrowing: { before: { atMs: 1_000, runId: "run-9" } },
      });

      const [election, outer] = sql.split(") SELECT ");
      for (const half of [election, outer]) {
        expect(half).toMatch(/CreatedAt < fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
        expect(half).toMatch(/RunId < \{v\d+:String\}/);
      }
      expect(Object.values(params)).toContain("run-9");
    });
  });
});

/** A written record as the read answers it: the instants under their `…Ms` keys. */
function record({
  CreatedAt: _created,
  UpdatedAt: _updated,
  StartedAt: _started,
  FinishedAt: _finished,
  OccurredAt: _occurred,
  AcceptedAt: _accepted,
  WrittenAt: _written,
  ...rest
}: ReturnType<typeof toWriteRecord> &
  Omit<InstantEvalRunRecord, keyof ReturnType<typeof toWriteRecord>>): InstantEvalRunRecord {
  return rest;
}

describe("given a run row written and read back", () => {
  describe("when it goes through both mappers", () => {
    it("comes back as the row that was written", () => {
      const row = instantEvalRunRow({
        parameters: { period: "7d" },
        questions: [{ id: "annoyed", kind: "boolean" }],
        plan: [{ column: "annoyed", function: "eval" }],
      });
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      const read = toRow(
        record({
          ...written,
          Name: written.Name,
          CreatedAtMs: written.CreatedAt.getTime(),
          UpdatedAtMs: written.UpdatedAt.getTime(),
          StartedAtMs: written.StartedAt?.getTime() ?? null,
          FinishedAtMs: written.FinishedAt?.getTime() ?? null,
          OccurredAtMs: written.OccurredAt?.getTime() ?? null,
          AcceptedAtMs: written.AcceptedAt?.getTime() ?? null,
        }),
      );

      expect(read).toEqual(row);
    });

    it("writes the checkpoint columns as empty rather than null, and reads them back as none", () => {
      const row = instantEvalRunRow({ lastEventId: null, projectionVersion: null });
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      expect(written.LastEventId).toBe("");
      expect(written.ProjectionVersion).toBe("");
      expect(
        toRow(
          record({
            ...written,
            CreatedAtMs: written.CreatedAt.getTime(),
            UpdatedAtMs: written.UpdatedAt.getTime(),
            StartedAtMs: null,
            FinishedAtMs: null,
            OccurredAtMs: null,
            AcceptedAtMs: null,
          }),
        ).lastEventId,
      ).toBeNull();
    });

    it("reads a status the table does not know as queued rather than trusting it", () => {
      const row = instantEvalRunRow();
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      const read = toRow(
        record({
          ...written,
          Status: "HALTED",
          Parameters: "not json",
          CreatedAtMs: written.CreatedAt.getTime(),
          UpdatedAtMs: written.UpdatedAt.getTime(),
          StartedAtMs: null,
          FinishedAtMs: null,
          OccurredAtMs: null,
          AcceptedAtMs: null,
        }),
      );

      expect(read.status).toBe("QUEUED");
      expect(read.parameters).toEqual({});
    });

    it("keeps the instants the driver answers as strings", () => {
      const row = instantEvalRunRow();
      const written = toWriteRecord({ row, writtenAt: row.updatedAt });

      const read = toRow(
        record({
          ...written,
          CreatedAtMs: String(written.CreatedAt.getTime()),
          UpdatedAtMs: String(written.UpdatedAt.getTime()),
          StartedAtMs: null,
          FinishedAtMs: null,
          OccurredAtMs: null,
          AcceptedAtMs: null,
        }),
      );

      expect(Temporal.Instant.compare(read.createdAt, row.createdAt)).toBe(0);
    });
  });
});
