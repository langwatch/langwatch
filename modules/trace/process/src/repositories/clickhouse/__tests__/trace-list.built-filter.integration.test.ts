/**
 * The trace list on built reads (ADR-202 Decided 25 and 27): the filter compiled inside each read
 * keeps main's rows under an own, a set and a windowed proof, with another tenant sharing every id.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Authorization } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceFilterCompileFor } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const run = nanoid(6);
const AGGREGATE = `proj_lb_agg_${run}`;
const MEMBER = `proj_lb_member_${run}`;
const OTHER = `proj_lb_other_${run}`;
const MINUTE = 60_000;
const base = Date.now() - 60 * MINUTE;
const WINDOW = { from: base - 120 * MINUTE, to: base + 30 * MINUTE };
/** The member's share starts here: its evaluation of t1 was scheduled before it. */
const SHARE_FROM = base - 30 * MINUTE;

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

const summary = (tenant: string, traceId: string, extra: Record<string, unknown> = {}) => ({
  TenantId: tenant,
  TraceId: traceId,
  OccurredAt: at(base - 10 * MINUTE),
  CreatedAt: at(base - 10 * MINUTE),
  UpdatedAt: at(base - 10 * MINUTE),
  _retention_days: 0,
  ComputedInput: "",
  ComputedOutput: "",
  ...extra,
});

const evaluation = (tenant: string, traceId: string, scheduledAtMs: number) => ({
  TenantId: tenant,
  EvaluationId: `ev_${tenant}_${traceId}`,
  EvaluatorId: "ev1",
  EvaluatorName: "faithfulness",
  TraceId: traceId,
  Status: "processed",
  Passed: 1,
  ScheduledAt: at(scheduledAtMs),
  CreatedAt: at(scheduledAtMs),
  UpdatedAt: at(scheduledAtMs),
});

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

async function listed({
  authorization,
  queryText,
}: {
  authorization: Authorization;
  queryText: string;
}): Promise<string[]> {
  const page = await repo.listAll({
    authorization,
    timeRange: WINDOW,
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 50,
    offset: 0,
    compileFilter: traceFilterCompileFor({ queryText, timeRange: WINDOW }),
  });
  return page.rows.map((row) => `${row.tenantId}:${row.traceId}`).toSorted();
}

const own = () => ownProof({ projectId: MEMBER });
const tenantSetOf = () =>
  aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: 0 }] });
const windowedShare = () =>
  aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: SHARE_FROM }] });

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceListClickHouseRepository.create({
    reader: traceQueryClientFor(ch),
  });
  const insert = (table: string, values: Record<string, unknown>[]) =>
    ch.insert({ table, values, format: "JSONEachRow" });
  await insert("trace_summaries", [
    summary(MEMBER, "t1", { ContainsErrorStatus: 1 }),
    summary(MEMBER, "t2"),
    summary(AGGREGATE, "t3"),
    summary(OTHER, "t1", { ContainsErrorStatus: 1 }),
    summary(OTHER, "t2", { ContainsErrorStatus: 1 }),
  ]);
  await insert("evaluation_runs", [
    evaluation(MEMBER, "t1", base - 60 * MINUTE),
    evaluation(OTHER, "t2", base - 10 * MINUTE),
  ]);
}, 300_000);

describe.skipIf(!clickHouseConfigured)("the trace list's built filter under each scope", () => {
  /** @scenario "The trace list keeps main's rows under an own and an aggregate proof" */
  it.each([
    ["no filter", "", [`${MEMBER}:t1`, `${MEMBER}:t2`]],
    ["a summary field", "status:error", [`${MEMBER}:t1`]],
    ["an evaluator", "evaluator:ev1", [`${MEMBER}:t1`]],
    ["a negated evaluator", "NOT evaluator:ev1", [`${MEMBER}:t2`]],
  ])("reads %s under the member's own proof as main does", async (_kind, queryText, rows) => {
    expect(await listed({ authorization: own(), queryText })).toEqual(rows);
  });

  /** @scenario "The trace list keeps main's rows under an own and an aggregate proof" */
  it.each([
    ["no filter", "", [`${AGGREGATE}:t3`, `${MEMBER}:t1`, `${MEMBER}:t2`]],
    ["a summary field", "status:error", [`${MEMBER}:t1`]],
    ["an evaluator", "evaluator:ev1", [`${MEMBER}:t1`]],
    ["a negated evaluator", "NOT evaluator:ev1", [`${AGGREGATE}:t3`, `${MEMBER}:t2`]],
  ])("reads %s under an aggregate's tenant set as main does", async (_kind, queryText, rows) => {
    expect(await listed({ authorization: tenantSetOf(), queryText })).toEqual(rows);
  });

  /** @scenario "The trace list no longer matches by a side row outside a share's window" */
  it("no longer matches a trace by an evaluation scheduled before the share's window", async () => {
    expect(await listed({ authorization: windowedShare(), queryText: "" })).toEqual([
      `${AGGREGATE}:t3`,
      `${MEMBER}:t1`,
      `${MEMBER}:t2`,
    ]);
    expect(await listed({ authorization: windowedShare(), queryText: "evaluator:ev1" })).toEqual(
      [],
    );
    expect(await listed({ authorization: own(), queryText: "evaluator:ev1" })).toEqual([
      `${MEMBER}:t1`,
    ]);
  });
});
