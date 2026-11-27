/** @vitest-environment node */

/**
 * The staff investigation read of coding agent sessions per day: a session folded twice counts
 * once, even when the refold moved its start across midnight, its user is counted, and a session
 * outside the window is left out.
 * @see modules/staff-access/specs/staff-access-functions-activity.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TestClock } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;
const tag = randomUUID();
const tenantId = `${tag}-daily`;
const day = Math.floor(Date.now() / DAY_MS) * DAY_MS - 2 * DAY_MS;

let ch: ClickHouseClient;
let repository: CodingAgentSessionClickHouseRepository;

function queryClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("the daily count never inserts")),
    command: () => Promise.reject(new Error("the daily count never commands")),
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

const clock = (ms: number): string => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

async function foldSession({
  sessionId,
  startedAtMs,
  version,
}: {
  sessionId: string;
  startedAtMs: number;
  version: number;
}) {
  const updatedAtMs = day + version * 1_000;
  await ch.insert({
    table: "coding_agent_sessions",
    values: [
      {
        TenantId: tenantId,
        SessionId: sessionId,
        SessionKeySource: "session_id",
        Version: "2026-07-24",
        StartedAt: clock(startedAtMs),
        CreatedAt: clock(startedAtMs),
        UpdatedAt: clock(Math.max(updatedAtMs, startedAtMs + version * 1_000)),
        Agent: "claude_code",
        UserId: "user_1",
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: {
      async_insert: 0,
      wait_for_async_insert: 0,
      date_time_input_format: "best_effort",
    },
  });
}

describe.skipIf(!clickHouseUrl)("coding agent sessions per day (real ClickHouse)", () => {
  beforeAll(async () => {
    ch = createTestClickHouseClient(clickHouseUrl as URL);
    repository = CodingAgentSessionClickHouseRepository.create({
      clickhouse: queryClient(ch),
      defaultTraceRetentionDays: 30,
      metrics: NoopCodingAgentReadMetricsService.create(),
      clock: new TestClock(Date.now()),
    });
    await foldSession({ sessionId: `${tag}-a`, startedAtMs: day + 3_600_000, version: 1 });
    await foldSession({ sessionId: `${tag}-a`, startedAtMs: day + 3_600_000, version: 2 });
    await foldSession({ sessionId: `${tag}-moved`, startedAtMs: day - 1_800_000, version: 1 });
    await foldSession({ sessionId: `${tag}-moved`, startedAtMs: day + 1_800_000, version: 3 });
    await foldSession({ sessionId: `${tag}-old`, startedAtMs: day - 20 * DAY_MS, version: 1 });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE coding_agent_sessions DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.close();
  });

  /** @scenario "Coding agent sessions per day count a refolded session once" */
  it("counts each refolded session once on its latest day and leaves the old one out", async () => {
    const counts = await repository.findDailySessionCounts({
      projectIds: [tenantId],
      since: day - 7 * DAY_MS,
      until: day + DAY_MS,
    });

    expect(counts).toEqual([
      { projectId: tenantId, day, agent: "claude_code", sessions: 2, users: 1 },
    ]);
  });
});
