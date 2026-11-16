/** @vitest-environment node */

/**
 * ADR-202: instant-eval's built reads on the migrated schema, sent as the reader with the tenant
 * setting through the routed member. Another tenant reuses the same run, trace and question ids.
 * Needs the migrated ClickHouse the running job supplies.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { instantEvalRunRow } from "../../../__tests__/instant-eval.fixtures.ts";
import type { InstantEvalJudgmentRecord } from "../../instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalJudgmentsRepository } from "../clickhouse.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalRunRepository } from "../clickhouse.instant-eval-run.repository.ts";
import {
  ClickHouseInstantEvalSession,
  type InstantEvalClickHouseResolver,
} from "../clickhouse.instant-eval-session.store.ts";
import { startInstantEvalReaderClickHouse } from "./support/clickhouse-endpoint.support.ts";

const tag = randomUUID();
const ours = `${tag}-ours`;
const theirs = `${tag}-theirs`;
const runId = `${tag}-run`;
const T0 = Date.UTC(2026, 8, 18, 10);
const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms);

let ch: ClickHouseClient;
let resolveClient: InstantEvalClickHouseResolver;

function verdict(overrides: Partial<InstantEvalJudgmentRecord>): InstantEvalJudgmentRecord {
  return {
    TenantId: ours,
    RunId: runId,
    TraceId: "trace-a",
    QuestionId: "q1",
    ThreadId: "",
    SpanId: "",
    Kind: "boolean",
    Status: "judged",
    Passed: 0,
    Score: null,
    Label: "",
    Probability: null,
    Probabilities: "{}",
    Error: "",
    OccurredAt: T0,
    CreatedAt: T0,
    UpdatedAt: T0,
    ...overrides,
  };
}

const window = { writtenFrom: at(T0 - 60_000), writtenUntil: at(T0 + 60_000) };

describe("instant-eval's built reads (real ClickHouse)", () => {
  beforeAll(async () => {
    const opened = await startInstantEvalReaderClickHouse();
    ch = opened.admin;
    const member = opened.worker;
    resolveClient = async (tenantId) => new ClickHouseInstantEvalSession(member, tenantId);
    const writer = (ms: number) =>
      ClickHouseInstantEvalRunRepository.create({ resolveClient, now: () => at(ms) });
    const base = { createdAt: at(T0), updatedAt: at(T0), status: "QUEUED" as const };
    await writer(T0).write(instantEvalRunRow({ ...base, id: runId, projectId: ours }));
    await writer(T0 + 1).write(
      instantEvalRunRow({ ...base, id: runId, projectId: ours, status: "FAILED" }),
    );
    await writer(T0).write(
      instantEvalRunRow({ ...base, id: `${runId}-2`, projectId: ours, createdAt: at(T0 + 5) }),
    );
    await writer(T0 + 9).write(
      instantEvalRunRow({ ...base, id: runId, projectId: theirs, name: "theirs" }),
    );
    const judgments = ClickHouseInstantEvalJudgmentsRepository.create({ resolveClient });
    await judgments.insert([
      verdict({}),
      verdict({ Passed: 1, UpdatedAt: T0 + 1 }),
      verdict({ TraceId: "trace-b" }),
    ]);
    await judgments.insert([verdict({ TenantId: theirs, Passed: 1, UpdatedAt: T0 + 9 })]);
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["instant_eval_runs", "instant_eval_judgments"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenants:Array(String)})`,
        query_params: { tenants: [ours, theirs] },
      });
    }
  });

  describe("given a run written twice and another tenant's run of the same id", () => {
    it("finds the latest version of our run and pages ours alone, newest first", async () => {
      const runs = ClickHouseInstantEvalRunRepository.create({ resolveClient });

      const found = await runs.findById({ projectId: ours, runId });
      const [first] = await runs.findPage({ projectId: ours, limit: 1 });
      const second = await runs.findPage({
        projectId: ours,
        limit: 5,
        before: first?.createdAt,
        beforeId: first?.id,
      });

      expect(found).toMatchObject({ id: runId, projectId: ours, status: "FAILED" });
      expect(first?.id).toBe(`${runId}-2`);
      expect(second.map((row) => [row.id, row.status])).toEqual([[runId, "FAILED"]]);
    });
  });

  describe("given a verdict written twice and another tenant's verdict of the same ids", () => {
    it("pages and samples the latest verdict of ours", async () => {
      const judgments = ClickHouseInstantEvalJudgmentsRepository.create({ resolveClient });
      const scope = { projectId: ours, runId, ...window };

      const matched = await judgments.getPage({ ...scope, limit: 10, matched: true });
      const unmatched = await judgments.getPage({ ...scope, limit: 10, matched: false });
      const sample = await judgments.findSample({
        ...scope,
        traces: 1,
        seed: 3,
        shouldPreferMatched: true,
      });

      expect(matched.judgments.map((each) => [each.traceId, each.passed])).toEqual([
        ["trace-a", true],
      ]);
      expect(unmatched.judgments.map((each) => each.traceId)).toEqual(["trace-b"]);
      expect(sample.map((each) => [each.traceId, each.passed])).toEqual([["trace-a", true]]);
    });
  });
});
