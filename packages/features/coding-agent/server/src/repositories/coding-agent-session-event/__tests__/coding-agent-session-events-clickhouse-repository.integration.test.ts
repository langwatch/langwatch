/**
 * Round-trips the per-call fact table (migration 00073) through its real
 * INSERT/SELECT SQL against the migrated ClickHouse the running job supplies:
 * the RecordId dedup the ReplacingMergeTree + `LIMIT 1 BY` read promise, and
 * the keyset pagination the REST export walks.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CodingAgentSessionEventRecord } from "@langwatch/coding-agent-contract";
import { CodingAgentClickHousePort } from "../../../ports/coding-agent-clickhouse.port";
import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

let ch: ClickHouseClient;
let repository: CodingAgentSessionEventsClickHouseRepository;

class SingleClickHousePort extends CodingAgentClickHousePort {
  constructor(private readonly client: ClickHouseClient) {
    super();
  }

  async resolve() {
    return this.client;
  }
}

const tag = nanoid();
const tenantId = `${tag}-project`;
const sessionId = `${tag}-session`;
const baseMs = Date.now();

function eventRecord(
  over: Partial<CodingAgentSessionEventRecord> = {},
): CodingAgentSessionEventRecord {
  return {
    tenantId,
    sessionId,
    timeUnixMs: baseMs,
    recordId: "a".repeat(64),
    eventKind: "model_call",
    agent: "claude_code",
    sessionKeySource: "provider",
    traceId: `${tag}-trace`,
    spanId: "",
    promptId: `${tag}-prompt`,
    querySource: "repl_main_thread",
    agentType: "",
    eventSequence: 1,
    requestId: "req_abc",
    model: "claude-haiku-4-5-20251001",
    inputTokens: 4,
    outputTokens: 120,
    cacheReadTokens: 13000,
    cacheCreationTokens: 250,
    costUsd: 0.0421,
    durationMs: 1800,
    ttftMs: 0,
    attempt: 0,
    speed: "standard",
    stopReason: "end_turn",
    preTokens: 0,
    postTokens: 0,
    compactionTrigger: "",
    precomputeReuse: "",
    statusCode: "",
    errorType: "",
    rateLimitCarrier: "",
    retryDurationMs: 0,
    toolName: "",
    success: "",
    decision: "",
    decisionSource: "",
    toolInputBytes: 0,
    toolResultBytes: 0,
    promptChars: 0,
    totalTokens: 0,
    repositoryHost: "",
    repositoryOwner: "",
    repositoryName: "",
    branch: "",
    ...over,
  };
}

beforeAll(async () => {
  if (!clickHouseUrl) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  repository = new CodingAgentSessionEventsClickHouseRepository(
    new SingleClickHousePort(ch),
    30,
  );
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE coding_agent_session_events DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.close();
  }
});

integration("CodingAgentSessionEventsClickHouseRepository", () => {
  describe("given the same event written twice", () => {
    /** @scenario "re-delivery does not duplicate a row" */
    it("lists the event exactly once", async () => {
      const record = eventRecord({ recordId: "b".repeat(64) });
      await repository.ensure([record]);
      await repository.ensure([record]);

      const { events } = await repository.findBySessionId({
        tenantId,
        sessionId,
        kinds: ["model_call"],
        limit: 10,
      });

      const matching = events.filter((event) => event.recordId === record.recordId);
      expect(matching).toHaveLength(1);
      expect(matching[0]?.costUsd).toBeCloseTo(0.0421);
      expect(matching[0]?.cacheReadTokens).toBe(13000);
      expect(matching[0]?.model).toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("given more stored events than one page", () => {
    const pagedSession = `${tag}-paged`;
    const records = Array.from({ length: 7 }, (_, index) =>
      eventRecord({
        sessionId: pagedSession,
        timeUnixMs: baseMs + index * 1000,
        recordId: `c${index}`.padEnd(64, "0"),
        eventKind: index % 2 === 0 ? "model_call" : "tool_result",
        eventSequence: index,
      }),
    );

    beforeAll(async () => {
      await repository.ensure(records);
    });

    /** @scenario "a session's events list in time order with stable pagination" */
    it("walks every event exactly once in ascending time order", async () => {
      const seen: string[] = [];
      let cursor;
      for (;;) {
        const page = await repository.findBySessionId({
          tenantId,
          sessionId: pagedSession,
          cursor,
          limit: 3,
        });
        seen.push(...page.events.map((event) => event.recordId));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toEqual(records.map((record) => record.recordId));
    });
  });
});
