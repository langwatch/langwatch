/**
 * Round-trips the per-call fact table (migration 00073) through its real
 * INSERT/SELECT SQL against the migrated ClickHouse the running job supplies:
 * the RecordId dedup the ReplacingMergeTree + `LIMIT 1 BY` read promise, and
 * the keyset pagination the REST export walks.
 */
import { randomUUID } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
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

const tag = randomUUID();
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
  repository = new CodingAgentSessionEventsClickHouseRepository(new SingleClickHousePort(ch), 30);
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

    it("filters by kind without disturbing the walk", async () => {
      const toolResultCount = records.filter((record) => record.eventKind === "tool_result").length;

      const { events } = await repository.findBySessionId({
        tenantId,
        sessionId: pagedSession,
        kinds: ["tool_result"],
        limit: 10,
      });

      expect(events.length).toBe(toolResultCount);
      expect(events.every((event) => event.eventKind === "tool_result")).toBe(true);
    });
  });

  describe("given a batch that spans two tenants", () => {
    it("refuses the write", async () => {
      await expect(
        repository.ensure([
          eventRecord({ recordId: "d".repeat(64) }),
          eventRecord({ tenantId: "other-tenant", recordId: "e".repeat(64) }),
        ]),
      ).rejects.toThrow(/spans multiple tenants/);
    });
  });

  describe("given two tenants whose sessions share one id", () => {
    const sharedSession = `${tag}-shared`;
    const otherTenantId = `${tag}-other-project`;

    beforeAll(async () => {
      await repository.ensure([
        eventRecord({
          sessionId: sharedSession,
          recordId: `f0`.padEnd(64, "0"),
          model: "claude-fable-5",
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          costUsd: 1.5,
        }),
        eventRecord({
          sessionId: sharedSession,
          recordId: `f1`.padEnd(64, "0"),
          timeUnixMs: baseMs + 1000,
          model: "claude-fable-5",
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheCreationTokens: 4,
          costUsd: 0.5,
        }),
        eventRecord({
          sessionId: sharedSession,
          recordId: `f2`.padEnd(64, "0"),
          timeUnixMs: baseMs + 2000,
          model: "gpt-5-mini",
          inputTokens: 5,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0.25,
        }),
        // Not a model call: no tokens of this may reach a model's total.
        eventRecord({
          sessionId: sharedSession,
          recordId: `f3`.padEnd(64, "0"),
          timeUnixMs: baseMs + 3000,
          eventKind: "tool_result",
          model: "",
          inputTokens: 999,
          outputTokens: 999,
          cacheReadTokens: 999,
          cacheCreationTokens: 999,
          costUsd: 99,
        }),
      ]);
      await repository.ensure([
        eventRecord({
          tenantId: otherTenantId,
          sessionId: sharedSession,
          recordId: `f4`.padEnd(64, "0"),
          model: "claude-fable-5",
          inputTokens: 7777,
          outputTokens: 7777,
          cacheReadTokens: 7777,
          cacheCreationTokens: 7777,
          costUsd: 77,
        }),
      ]);
    });

    /** @scenario "The per-model read is scoped to the tenant and to a bounded period" */
    it("counts only the asked tenant's rows", async () => {
      const totals = await repository.sumTokensByModelPerSession({
        tenantIds: [tenantId],
        sessionIds: [sharedSession],
        fromMs: baseMs - 60_000,
      });

      const fable = totals.find((row) => row.model === "claude-fable-5");
      expect(fable?.tenantId).toBe(tenantId);
      expect(fable?.inputTokens).toBe(11);
      expect(fable?.outputTokens).toBe(22);
      expect(fable?.cacheReadTokens).toBe(33);
      expect(fable?.cacheCreationTokens).toBe(44);
      expect(fable?.costUsd).toBeCloseTo(2.0);
      expect(totals.every((row) => row.tenantId === tenantId)).toBe(true);
    });

    it("returns nothing for a period that starts after the events", async () => {
      const totals = await repository.sumTokensByModelPerSession({
        tenantIds: [tenantId],
        sessionIds: [sharedSession],
        fromMs: baseMs + 60_000,
      });

      expect(totals).toEqual([]);
    });

    /** @scenario "Only model calls count toward the per-model totals" */
    it("leaves tool runs and compactions out of the totals", async () => {
      const totals = await repository.sumTokensByModelPerSession({
        tenantIds: [tenantId],
        sessionIds: [sharedSession],
        fromMs: baseMs - 60_000,
      });

      expect(totals.map((row) => row.model).sort()).toEqual(["claude-fable-5", "gpt-5-mini"]);
      expect(totals.every((row) => row.inputTokens < 999 && row.costUsd < 99)).toBe(true);
    });
  });

  describe("given events stamped with a working context", () => {
    const stampedSession = `${tag}-stamped-session`;
    const stamp = {
      repositoryHost: "GitHub.com",
      repositoryOwner: "Acme",
      repositoryName: "Widgets",
    };

    beforeAll(async () => {
      await repository.ensure([
        eventRecord({
          sessionId: stampedSession,
          recordId: "1".repeat(64),
          ...stamp,
          branch: "feat/split",
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0.1,
        }),
        eventRecord({
          sessionId: stampedSession,
          recordId: "2".repeat(64),
          timeUnixMs: baseMs + 1_000,
          ...stamp,
          branch: "feat/other",
          inputTokens: 30,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0.2,
        }),
        eventRecord({
          sessionId: stampedSession,
          recordId: "3".repeat(64),
          timeUnixMs: baseMs + 2_000,
          inputTokens: 50,
          outputTokens: 60,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0.3,
        }),
      ]);
    });

    describe("when the per-model totals are read", () => {
      it("round-trips the stamp and returns one total per context", async () => {
        const totals = await repository.sumTokensByModelPerSession({
          tenantIds: [tenantId],
          sessionIds: [stampedSession],
          fromMs: baseMs - 60_000,
        });

        const byBranch = new Map(totals.map((row) => [row.branch, row]));
        expect(byBranch.get("feat/split")?.inputTokens).toBe(10);
        expect(byBranch.get("feat/split")?.repositoryOwner).toBe("Acme");
        expect(byBranch.get("feat/other")?.inputTokens).toBe(30);
        expect(byBranch.get("")?.inputTokens).toBe(50);
        expect(byBranch.get("")?.repositoryOwner).toBe("");
      });
    });

    describe("when a stamped branch is looked up", () => {
      it("finds the session, case-folding the repository", async () => {
        const pairs = await repository.listSessionsByStampedBranch({
          tenantIds: [tenantId],
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          branches: ["feat/split"],
          fromMs: baseMs - 60_000,
        });

        expect(pairs).toEqual([{ tenantId, sessionId: stampedSession }]);
      });
    });

    describe("when a branch nothing was stamped on is looked up", () => {
      it("answers nothing", async () => {
        const pairs = await repository.listSessionsByStampedBranch({
          tenantIds: [tenantId],
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          branches: ["feat/never-stamped"],
          fromMs: baseMs - 60_000,
        });

        expect(pairs).toEqual([]);
      });
    });
  });
});
