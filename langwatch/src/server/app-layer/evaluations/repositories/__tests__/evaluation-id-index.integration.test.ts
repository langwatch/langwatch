/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the bloom_filter skip-index on evaluation_runs.EvaluationId
 * (migration 00042):
 *  - the migration attaches idx_evaluation_id to the table, and
 *  - the (TenantId, EvaluationId) point-lookup shapes still return the right
 *    rows, including the ScheduledAt resolve that bounds getByEvaluationId.
 *
 * evaluation_runs is PARTITION BY toYearWeek(ScheduledAt), so a lookup that
 * carries no ScheduledAt predicate cannot prune partitions: the primary key
 * lands on one candidate granule in every part and, without a skip index on
 * EvaluationId, reads all of them. The index lets ClickHouse skip granules that
 * cannot contain the id. Correctness is identical either way, which is what
 * this test pins.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";

let ch: ClickHouseClient;
const tag = nanoid();

async function insertRun({
  tenantId,
  evaluationId,
  scheduledAt,
  updatedAt,
}: {
  tenantId: string;
  evaluationId: string;
  scheduledAt: Date;
  updatedAt: Date;
}) {
  await ch.insert({
    table: "evaluation_runs",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        EvaluationId: evaluationId,
        Version: "v1",
        EvaluatorId: "evaluator-1",
        EvaluatorType: "llm",
        EvaluatorName: "test-evaluator",
        TraceId: `${tag}-trace`,
        IsGuardrail: 0,
        Status: "processed",
        Score: 1,
        Passed: 1,
        Label: null,
        Details: null,
        Error: null,
        ErrorDetails: null,
        CreatedAt: scheduledAt,
        UpdatedAt: updatedAt,
        ArchivedAt: null,
        ScheduledAt: scheduledAt,
        StartedAt: null,
        CompletedAt: null,
        CostId: null,
        LastProcessedEventId: "",
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** The resolve shape used to bound getByEvaluationId's partition scan. */
async function resolveScheduledAtMs(tenantId: string, evaluationId: string) {
  const rows = await (
    await ch.query({
      query: `
        SELECT toUnixTimestamp64Milli(argMax(ScheduledAt, UpdatedAt)) AS scheduledAtMs
        FROM evaluation_runs
        WHERE TenantId = {tenantId:String}
          AND EvaluationId = {evaluationId:String}
      `,
      query_params: { tenantId, evaluationId },
      format: "JSONEachRow",
    })
  ).json<{ scheduledAtMs: string | number | null }>();
  const raw = rows[0]?.scheduledAtMs;
  if (raw === null || raw === undefined) return undefined;
  const ms = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE evaluation_runs DELETE WHERE startsWith(TenantId, {tag:String})`,
      query_params: { tag },
    });
  }
  await stopTestContainers();
});

describe("evaluation_runs EvaluationId skip-index (migration 00042)", () => {
  it("attaches a bloom_filter index on EvaluationId", async () => {
    const ddl = await (
      await ch.query({
        query: "SHOW CREATE TABLE evaluation_runs",
        format: "TabSeparatedRaw",
      })
    ).text();
    expect(ddl).toMatch(/INDEX\s+idx_evaluation_id\b/i);
    expect(ddl).toMatch(/idx_evaluation_id[\s\S]*TYPE\s+bloom_filter/i);
  });

  describe("when resolving ScheduledAt for an existing evaluation", () => {
    it("returns the ScheduledAt of the latest version", async () => {
      const tenantId = `${tag}-tenant-a`;
      const evaluationId = `${tag}-eval-1`;
      const older = new Date("2026-01-05T00:00:00.000Z");
      const newer = new Date("2026-02-09T00:00:00.000Z");

      // Two versions of the same run; the later UpdatedAt wins the argMax.
      await insertRun({
        tenantId,
        evaluationId,
        scheduledAt: older,
        updatedAt: new Date("2026-01-05T00:00:01.000Z"),
      });
      await insertRun({
        tenantId,
        evaluationId,
        scheduledAt: newer,
        updatedAt: new Date("2026-02-09T00:00:01.000Z"),
      });
      // A different evaluation the lookup must not pick up.
      await insertRun({
        tenantId,
        evaluationId: `${tag}-eval-2`,
        scheduledAt: new Date("2026-03-09T00:00:00.000Z"),
        updatedAt: new Date("2026-03-09T00:00:01.000Z"),
      });

      expect(await resolveScheduledAtMs(tenantId, evaluationId)).toBe(
        newer.getTime(),
      );
    });
  });

  describe("when resolving an evaluation that does not exist", () => {
    it("returns undefined so the caller stays unbounded", async () => {
      const tenantId = `${tag}-tenant-a`;
      expect(
        await resolveScheduledAtMs(tenantId, `${tag}-missing-eval`),
      ).toBeUndefined();
    });
  });

  describe("when two tenants share an evaluation id", () => {
    it("keeps the lookup scoped to the requesting tenant", async () => {
      const evaluationId = `${tag}-shared-eval`;
      const mine = new Date("2026-04-06T00:00:00.000Z");
      const theirs = new Date("2026-05-04T00:00:00.000Z");

      await insertRun({
        tenantId: `${tag}-tenant-b`,
        evaluationId,
        scheduledAt: mine,
        updatedAt: new Date("2026-04-06T00:00:01.000Z"),
      });
      await insertRun({
        tenantId: `${tag}-tenant-c`,
        evaluationId,
        scheduledAt: theirs,
        updatedAt: new Date("2026-05-04T00:00:01.000Z"),
      });

      expect(await resolveScheduledAtMs(`${tag}-tenant-b`, evaluationId)).toBe(
        mine.getTime(),
      );
      expect(await resolveScheduledAtMs(`${tag}-tenant-c`, evaluationId)).toBe(
        theirs.getTime(),
      );
    });
  });
});
