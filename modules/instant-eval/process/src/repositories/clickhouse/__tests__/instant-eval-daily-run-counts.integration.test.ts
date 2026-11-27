/** @vitest-environment node */

/**
 * The staff investigation read of Instant Eval runs per day: each run once at its latest version,
 * the rows judged, a failed run counted under its code, one row per UTC day, a run at `since`
 * counted and one at `until` or in another project left out.
 * @see modules/staff-access/specs/staff-access-functions-activity.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseInstantEvalRunRepository } from "../clickhouse.instant-eval-run.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;
const tag = randomUUID();
const projectId = `${tag}-daily`;
const otherProjectId = `${tag}-other`;
const day = Math.floor(Date.now() / DAY_MS) * DAY_MS - 2 * DAY_MS;
const since = day - 3 * DAY_MS;
const until = day + DAY_MS;

let ch: ClickHouseClient;
let runs: ClickHouseInstantEvalRunRepository;

async function runEndingAs({
  id,
  atMs,
  status,
  error,
  project = projectId,
}: {
  id: string;
  atMs: number;
  status: "FINISHED" | "FAILED";
  error: string | null;
  project?: string;
}) {
  const created = await ClickHouseInstantEvalRunRepository.create({
    resolveClient: async () => ch,
    now: () => Temporal.Instant.fromEpochMilliseconds(atMs),
  }).create({
    id,
    projectId: project,
    name: null,
    sql: "SELECT 1",
    parameters: {},
    questions: [],
    plan: [],
    rowLimit: 10,
  });
  await runs.write({
    ...created,
    status,
    error,
    total: 10,
    progress: status === "FINISHED" ? 10 : 4,
    priceUsd: 0.5,
    updatedAt: Temporal.Instant.fromEpochMilliseconds(atMs + 1_000),
  });
}

describe.skipIf(!clickHouseUrl)("Instant Eval runs per day (real ClickHouse)", () => {
  beforeAll(async () => {
    ch = createTestClickHouseClient(clickHouseUrl as URL);
    runs = ClickHouseInstantEvalRunRepository.create({ resolveClient: async () => ch });
    await runEndingAs({
      id: `${tag}-done`,
      atMs: day + 3_600_000,
      status: "FINISHED",
      error: null,
    });
    await runEndingAs({
      id: `${tag}-failed`,
      atMs: day + 7_200_000,
      status: "FAILED",
      error: "provider_rate_limited",
    });
    await runEndingAs({ id: `${tag}-since`, atMs: since, status: "FINISHED", error: null });
    await runEndingAs({ id: `${tag}-until`, atMs: until, status: "FINISHED", error: null });
    await runEndingAs({
      id: `${tag}-elsewhere`,
      atMs: day + 3_600_000,
      status: "FINISHED",
      error: null,
      project: otherProjectId,
    });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE instant_eval_runs DELETE WHERE TenantId IN ({projectIds:Array(String)})",
      query_params: { projectIds: [projectId, otherProjectId] },
    });
    await ch.close();
  });

  /** @scenario "Instant Eval runs per day carry failures by code at their latest version" */
  it("carries each day's runs, the rows judged and the failure under its code", async () => {
    const days = await runs.findDailyRunCounts({ projectIds: [projectId], since, until });

    expect(days.toSorted((a, b) => a.day - b.day)).toEqual([
      {
        projectId,
        day: since,
        runs: 1,
        judgedRows: 10,
        largestRun: 10,
        failedRuns: 0,
        failedByCode: [],
        priceUsd: 0.5,
        lastRunAt: since,
      },
      {
        projectId,
        day,
        runs: 2,
        judgedRows: 14,
        largestRun: 10,
        failedRuns: 1,
        failedByCode: [{ code: "provider_rate_limited", count: 1 }],
        priceUsd: 1,
        lastRunAt: day + 7_200_000,
      },
    ]);
  });
});
