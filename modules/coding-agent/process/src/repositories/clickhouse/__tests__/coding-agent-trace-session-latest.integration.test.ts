/**
 * Reads a session's newest trace mapping through real ClickHouse SQL.
 * @see specs/coding-agent/sessions-screen.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CODING_AGENT_ID_INDEXES } from "../clickhouse.coding-agent-id-indexes.database.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "../clickhouse.coding-agent-trace-session.repository.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();
const tenantId = `${randomUUID()}-latest-turn`;
const sessionId = "claude-session-1";
const baseMs = Date.now() - 60_000;

let ch: ClickHouseClient;
let traceSessions: CodingAgentTraceSessionClickHouseRepository;

beforeAll(async () => {
  if (clickHouseUrl === null) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  traceSessions = CodingAgentTraceSessionClickHouseRepository.create({
    clickhouse: vendorQueryClient({ vendor: ch, indexes: CODING_AGENT_ID_INDEXES }),
    defaultTraceRetentionDays: 30,
  });
  await traceSessions.ensure(
    [
      { tenantId, traceId: "trace-early", sessionId, occurredAtMs: baseMs },
      { tenantId, traceId: "trace-late", sessionId, occurredAtMs: baseMs + 5_000 },
      { tenantId, traceId: "trace-other", sessionId: "other", occurredAtMs: baseMs + 9_000 },
    ],
    30,
  );
});

afterAll(async () => {
  if (clickHouseUrl === null) return;
  await ch.command({
    query: "ALTER TABLE coding_agent_trace_sessions DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
  await ch.close();
});

describe.skipIf(clickHouseUrl === null)("coding_agent_trace_sessions latest by session", () => {
  /** @scenario "The session's latest stored trace is found through its own trace map" */
  it("answers the session's newest mapped trace inside the window", async () => {
    await expect(
      traceSessions.findLatestBySessionId({
        tenantId,
        sessionId,
        fromMs: baseMs - 60_000,
        toMs: baseMs + 60_000,
      }),
    ).resolves.toEqual({
      tenantId,
      traceId: "trace-late",
      sessionId,
      occurredAtMs: baseMs + 5_000,
    });
  });

  it("answers nothing for a session with no mapping in the window", async () => {
    await expect(
      traceSessions.findLatestBySessionId({
        tenantId,
        sessionId: "never-mapped",
        fromMs: baseMs - 60_000,
        toMs: baseMs + 60_000,
      }),
    ).resolves.toBeNull();
    await expect(
      traceSessions.findLatestBySessionId({
        tenantId: `${tenantId}-elsewhere`,
        sessionId,
        fromMs: baseMs - 60_000,
        toMs: baseMs + 60_000,
      }),
    ).resolves.toBeNull();
  });
});
