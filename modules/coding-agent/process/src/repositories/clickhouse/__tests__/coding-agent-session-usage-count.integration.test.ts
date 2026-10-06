/** @vitest-environment node */

/**
 * The usage report's coding agent session figures, read from the session aggregate: a session
 * folded twice counts once, the windows cut on when it started, and the first session is dated
 * from the oldest row. Needs the migrated ClickHouse the running job supplies.
 * @see specs/self-hosting/connected-services/usage-report.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TestClock } from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../services/coding-agent-read-metrics-noop.service.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";
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
    insert: () => Promise.reject(new Error("the usage count never inserts")),
    command: () => Promise.reject(new Error("the usage count never commands")),
  };
  return new ClickHouseQueryClient({ driver });
}

const clock = (ms: number): string => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

/** One fold of a session: the same session id written again lands as a later version. */
async function foldSession({
  sessionId,
  startedAtMs,
  version,
}: {
  sessionId: string;
  startedAtMs: number;
  version: number;
}) {
  await ch.insert({
    table: "coding_agent_sessions",
    values: [
      {
        TenantId: install,
        SessionId: sessionId,
        SessionKeySource: "session_id",
        Version: "2026-07-24",
        StartedAt: clock(startedAtMs),
        CreatedAt: clock(startedAtMs),
        UpdatedAt: clock(startedAtMs + version * 1_000),
        Agent: "claude_code",
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

describe.skipIf(!clickHouseUrl)(
  "the coding agent figures of the usage report (real ClickHouse)",
  () => {
    const recentMs = now - 3 * DAY_MS;
    const oldMs = now - 40 * DAY_MS;

    beforeAll(async () => {
      ch = createTestClickHouseClient(clickHouseUrl as URL);
      repository = CodingAgentSessionClickHouseRepository.create({
        clickhouse: queryClient(ch),
        defaultTraceRetentionDays: 30,
        metrics: NoopCodingAgentReadMetricsService.create(),
        clock: new TestClock(now),
      });
      await foldSession({ sessionId: `${tag}-recent`, startedAtMs: recentMs, version: 1 });
      await foldSession({ sessionId: `${tag}-recent`, startedAtMs: recentMs, version: 2 });
      await foldSession({ sessionId: `${tag}-old`, startedAtMs: oldMs, version: 1 });
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      await ch.exec({
        query: "ALTER TABLE coding_agent_sessions DELETE WHERE TenantId = {install:String}",
        query_params: { install },
      });
      await ch.close();
    });

    describe("given a coding agent session folded twice and a session from forty days ago", () => {
      describe("when sessions are counted", () => {
        /** @scenario Coding agent sessions are counted once each */
        it("counts the re-folded session once and leaves the old one out of the windows", async () => {
          const projectIds = [install];

          const lifetime = await repository.countUsage({ projectIds });
          const sevenDays = await repository.countUsage({ projectIds, since: now - 7 * DAY_MS });
          const twentyEightDays = await repository.countUsage({
            projectIds,
            since: now - 28 * DAY_MS,
          });

          expect(lifetime.sessions).toBe(2);
          expect(sevenDays.sessions).toBe(1);
          expect(twentyEightDays.sessions).toBe(1);
        });
      });
    });

    describe("given an install that reached the first coding agent session and one that never did", () => {
      describe("when the first session is read", () => {
        /** @scenario The ladder gains the first gateway request, Instant Eval run and coding agent session */
        it("dates the rung from the oldest row where there is one, and leaves it out where none", async () => {
          const reached = await repository.countUsage({ projectIds: [install] });
          const unreached = await repository.countUsage({ projectIds: [never] });

          expect(reached.firstSessionAt).toBe(Math.floor(oldMs));
          expect(unreached).toEqual({ sessions: 0 });
        });
      });
    });
  },
);
