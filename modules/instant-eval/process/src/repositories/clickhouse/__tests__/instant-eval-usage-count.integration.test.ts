/** @vitest-environment node */

/**
 * The usage report's Instant Eval figures: runs and judgements counted lifetime and over two
 * windows, and the first run dated from the oldest row. Needs the migrated ClickHouse the
 * running job supplies.
 * @see specs/self-hosting/connected-services/usage-report.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseInstantEvalJudgmentsRepository } from "../clickhouse.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalRunRepository } from "../clickhouse.instant-eval-run.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;
const tag = randomUUID();
const install = `${tag}-install`;
const never = `${tag}-never`;
const now = Date.now();
const ago = (days: number): number => now - days * DAY_MS;

let ch: ClickHouseClient;
let runs: ClickHouseInstantEvalRunRepository;
let judgments: ClickHouseInstantEvalJudgmentsRepository;

/** A run created at a pinned moment, as the repository stamps it on its own clock. */
async function runCreatedAt({ id, atMs }: { id: string; atMs: number }) {
  const at = Temporal.Instant.fromEpochMilliseconds(atMs);
  await ClickHouseInstantEvalRunRepository.create({
    resolveClient: async () => ch,
    now: () => at,
  }).create({
    id,
    projectId: install,
    name: null,
    sql: "SELECT 1",
    parameters: {},
    questions: [],
    plan: [],
    rowLimit: 10,
  });
}

function judgmentCreatedAt({ runId, atMs, index }: { runId: string; atMs: number; index: number }) {
  return {
    TenantId: install,
    RunId: runId,
    TraceId: `${runId}-trace-${index}`,
    QuestionId: "q1",
    ThreadId: "",
    SpanId: "",
    Kind: "boolean",
    Status: "judged" as const,
    Passed: 1,
    Score: null,
    Label: "",
    Probability: null,
    Probabilities: "{}",
    Error: "",
    OccurredAt: atMs,
    CreatedAt: atMs,
    UpdatedAt: atMs,
  };
}

describe.skipIf(!clickHouseUrl)(
  "the Instant Eval figures of the usage report (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ch = createTestClickHouseClient(clickHouseUrl as URL);
      runs = ClickHouseInstantEvalRunRepository.create({ resolveClient: async () => ch });
      judgments = ClickHouseInstantEvalJudgmentsRepository.create({
        resolveClient: async () => ch,
      });
      await runCreatedAt({ id: `${tag}-recent`, atMs: ago(3) });
      await runCreatedAt({ id: `${tag}-middle`, atMs: ago(20) });
      await runCreatedAt({ id: `${tag}-old`, atMs: ago(40) });
      await judgments.insert([
        judgmentCreatedAt({ runId: `${tag}-recent`, atMs: ago(3), index: 1 }),
        judgmentCreatedAt({ runId: `${tag}-recent`, atMs: ago(3), index: 2 }),
        judgmentCreatedAt({ runId: `${tag}-middle`, atMs: ago(20), index: 1 }),
        judgmentCreatedAt({ runId: `${tag}-old`, atMs: ago(40), index: 1 }),
      ]);
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      for (const table of ["instant_eval_runs", "instant_eval_judgments"]) {
        await ch.exec({
          query: `ALTER TABLE ${table} DELETE WHERE TenantId = {install:String}`,
          query_params: { install },
        });
      }
      await ch.close();
    });

    describe("given an Instant Eval run three days ago with two judgments, one twenty days ago, and one forty days ago", () => {
      describe("when runs and judgments are counted", () => {
        /** @scenario Instant Eval runs and judgments are counted */
        it("counts each lifetime and over both windows, and dates the first run from the oldest row", async () => {
          const projectIds = [install];
          const count = async (since?: number) => ({
            ...(await runs.countUsage({ projectIds, ...(since === undefined ? {} : { since }) })),
            judgments: await judgments.countUsage({
              projectIds,
              ...(since === undefined ? {} : { since }),
            }),
          });

          const lifetime = await count();
          const sevenDays = await count(ago(7));
          const twentyEightDays = await count(ago(28));

          expect(lifetime).toMatchObject({ runs: 3, judgments: 4, firstRunAt: ago(40) });
          expect(sevenDays).toMatchObject({ runs: 1, judgments: 2 });
          expect(twentyEightDays).toMatchObject({ runs: 2, judgments: 3 });
        });
      });
    });

    describe("given an install that never ran an Instant Eval", () => {
      describe("when the first run is read", () => {
        /** @scenario The ladder gains the first gateway request, Instant Eval run and coding agent session */
        it("dates the rung from the oldest row where there is one, and leaves it out where none", async () => {
          const reached = await runs.countUsage({ projectIds: [install] });
          const unreached = await runs.countUsage({ projectIds: [never] });

          expect(reached.firstRunAt).toBe(ago(40));
          expect(unreached).toEqual({ runs: 0 });
        });
      });
    });
  },
);
