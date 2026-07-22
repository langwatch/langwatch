import { afterEach, describe, expect, it, vi } from "vitest";

// Stable singleton logger so a test can spy the SAME `warn` fn the reactor
// module captured at import time (`const logger = createLogger(...)` runs once).
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => loggerMock,
}));

import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_DROPPED_LOG_COUNT_ATTR,
  CLAUDE_TRUNCATED_LOGS_ATTR,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import type { StoredLogRecordRow } from "~/server/event-sourcing/ports/log-record-storage.repository";
import type { RecordSpanCommandData } from "../../schemas/commands";
import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../schemas/constants";
import type {
  LogContributedEvent,
  LogRecordReceivedEvent,
  SpanReceivedEvent,
} from "../../schemas/events";
import type { OtlpSpan } from "../../schemas/otlp";
import { createClaudeCodeSpanSyncReactor } from "../claudeCodeSpanSync.reactor";

const SCOPE = "com.anthropic.claude_code.events";
const TENANT = "project_test";
const TRACE = "a3c6656cf433e97549f654034be02955";

const row = (
  eventName: string,
  attrs: Record<string, string>,
  timeUnixMs: number,
  spanId = "0000000000000000",
): StoredLogRecordRow => ({
  traceId: TRACE,
  spanId,
  timeUnixMs,
  attributes: {
    "event.name": eventName,
    [CLAUDE_CODE_KIND_ATTR]: "x",
    ...attrs,
  },
  resourceAttributes: { "service.name": "claude-code" },
  scopeName: SCOPE,
  scopeVersion: "2.1.62",
});

// A whole tool-using turn delivered (as it really is) across batches: the
// request body lands first, the anchor + response + tool_result later, and the
// tool's output only appears in the NEXT model call's request body transcript.
const turnRows = (): StoredLogRecordRow[] => [
  row(
    "user_prompt",
    { "session.id": "s", "prompt.id": "p", prompt: "List /tmp" },
    100,
    "aa00000000000001",
  ),
  row(
    "api_request_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      body: JSON.stringify({
        model: "claude-opus-4-8",
        messages: [
          { role: "user", content: [{ type: "text", text: "List /tmp" }] },
        ],
      }),
    },
    200,
    "aa00000000000002",
  ),
  row(
    "tool_result",
    {
      "session.id": "s",
      tool_name: "Bash",
      tool_use_id: "toolu_1",
      success: "true",
      duration_ms: "50",
      tool_input: '{"command":"ls /tmp"}',
    },
    1_000,
    "aa00000000000003",
  ),
  row(
    "api_request",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      input_tokens: "100",
      output_tokens: "20",
      cost_usd: "0.05",
      duration_ms: "800",
      request_id: "req_1",
      query_source: "repl_main_thread",
    },
    1_200,
    "aa00000000000004",
  ),
  row(
    "api_response_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      request_id: "req_1",
      query_source: "repl_main_thread",
      body: JSON.stringify({
        content: [{ type: "text", text: "There are 3 files." }],
      }),
    },
    1_200,
    "aa00000000000005",
  ),
  // The next model call's request feeds the tool's result back to the model.
  row(
    "api_request_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      body: JSON.stringify({
        model: "claude-opus-4-8",
        messages: [
          {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_1",
                type: "tool_result",
                content: "a.txt\nb.txt\nc.txt",
              },
            ],
          },
        ],
      }),
    },
    2_000,
    "aa00000000000006",
  ),
];

const logEvent = (): LogRecordReceivedEvent =>
  ({
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE,
    occurredAt: 1_700_000_000_000,
    data: { scopeName: SCOPE },
  }) as unknown as LogRecordReceivedEvent;

const contributionEvent = (): LogContributedEvent =>
  ({
    type: LOG_CONTRIBUTED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE,
    occurredAt: 1_800_000_000_000,
    data: {
      scopeName: SCOPE,
      timeUnixMs: 1_700_000_000_000,
    },
  }) as unknown as LogContributedEvent;

const spanType = (s: OtlpSpan): string | undefined =>
  (
    s.attributes.find((a) => a.key === "langwatch.span.type")?.value as {
      stringValue?: string;
    }
  )?.stringValue;
const strAttr = (s: OtlpSpan, key: string): string | undefined =>
  (s.attributes.find((a) => a.key === key)?.value as { stringValue?: string })
    ?.stringValue;
const boolAttr = (s: OtlpSpan, key: string): boolean | undefined =>
  (s.attributes.find((a) => a.key === key)?.value as { boolValue?: boolean })
    ?.boolValue;
const intAttr = (s: OtlpSpan, key: string): number | undefined => {
  const raw = (
    s.attributes.find((a) => a.key === key)?.value as {
      intValue?: number | string;
    }
  )?.intValue;
  return raw === undefined ? undefined : Number(raw);
};

// One synthetic model call (anchor + request/response bodies) as three marked
// log rows, so N distinct calls make 3N convertible records for the cap tests.
const modelCallRows = (i: number): StoredLogRecordRow[] => {
  const requestId = `req_${i}`;
  const t = 10_000 + i * 10;
  return [
    row(
      "api_request_body",
      {
        "session.id": "s",
        model: "claude-opus-4-8",
        query_source: `qs_${i}`,
        "event.sequence": String(i * 3 + 1),
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      },
      t,
      `bb${i.toString(16).padStart(14, "0")}`,
    ),
    row(
      "api_request",
      {
        "session.id": "s",
        model: "claude-opus-4-8",
        request_id: requestId,
        query_source: `qs_${i}`,
        input_tokens: "1",
        output_tokens: "1",
        "event.sequence": String(i * 3 + 2),
      },
      t + 1,
      `cc${i.toString(16).padStart(14, "0")}`,
    ),
    row(
      "api_response_body",
      {
        "session.id": "s",
        model: "claude-opus-4-8",
        request_id: requestId,
        query_source: `qs_${i}`,
        "event.sequence": String(i * 3 + 3),
        body: JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
      },
      t + 1,
      `dd${i.toString(16).padStart(14, "0")}`,
    ),
  ];
};

// A turn of `calls` model calls preceded by the user_prompt row.
const manyCallTurnRows = (calls: number): StoredLogRecordRow[] => {
  const rows: StoredLogRecordRow[] = [
    row(
      "user_prompt",
      {
        "session.id": "s",
        "prompt.id": "p",
        prompt: "Do many things",
        "event.sequence": "0",
      },
      100,
      "aa00000000000001",
    ),
  ];
  for (let i = 0; i < calls; i++) rows.push(...modelCallRows(i));
  return rows;
};

// Cap-aware setup: the marked-log fetch honours the reactor's `cap + 1` limit
// (turn order), so the reactor sees an overflowing turn exactly as production
// would. `turnLogCap` is injected so the test can use a small cap. The uncapped
// count dep is what the reactor queries to stamp the TRUE dropped count when a
// turn overflows; by default it returns the full row set's size, but a test can
// override it (a fixed total, or a rejection to exercise the fallback).
function capSetup(
  rows: StoredLogRecordRow[],
  turnLogCap: number,
  countMarkedClaudeCodeLogs = vi.fn(async () => rows.length),
) {
  const getMarkedClaudeCodeLogs = vi.fn(
    async (
      _tenantId: string,
      _traceId: string,
      _occurredAtMs?: number,
      limit?: number,
    ) => (typeof limit === "number" ? rows.slice(0, limit) : rows),
  );
  const recorded: RecordSpanCommandData[] = [];
  const recordSpan = vi.fn(async (data: RecordSpanCommandData) => {
    recorded.push(data);
  });
  const reactor = createClaudeCodeSpanSyncReactor({
    getMarkedClaudeCodeLogs,
    countMarkedClaudeCodeLogs,
    recordSpan,
    turnLogCap,
  });
  return {
    reactor,
    getMarkedClaudeCodeLogs,
    countMarkedClaudeCodeLogs,
    recordSpan,
    recorded,
  };
}

function setup(
  rows: StoredLogRecordRow[],
  opts?: { now?: () => number; visibilityDeadlineMs?: number },
) {
  const getMarkedClaudeCodeLogs = vi.fn(async () => rows);
  const countMarkedClaudeCodeLogs = vi.fn(async () => rows.length);
  const recorded: RecordSpanCommandData[] = [];
  const recordSpan = vi.fn(async (data: RecordSpanCommandData) => {
    recorded.push(data);
  });
  const reactor = createClaudeCodeSpanSyncReactor({
    getMarkedClaudeCodeLogs,
    countMarkedClaudeCodeLogs,
    recordSpan,
    ...(opts?.now ? { now: opts.now } : {}),
    ...(opts?.visibilityDeadlineMs !== undefined
      ? { visibilityDeadlineMs: opts.visibilityDeadlineMs }
      : {}),
  });
  return {
    reactor,
    getMarkedClaudeCodeLogs,
    countMarkedClaudeCodeLogs,
    recordSpan,
    recorded,
  };
}

describe("createClaudeCodeSpanSyncReactor", () => {
  describe("when a claude_code log is folded over the whole turn", () => {
    it("emits a root turn span with the model + tool spans as complete children", async () => {
      const { reactor, recorded } = setup(turnRows());
      await reactor.handle(logEvent(), {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      });

      const spans = recorded.map((r) => r.span);
      const root = spans.find((s) => s.parentSpanId === null)!;
      const model = spans.find((s) => spanType(s) === "llm")!;
      const tool = spans.find((s) => spanType(s) === "tool")!;

      // Root carries the user's prompt; model + tool are its children.
      expect(spanType(root)).toBe("agent");
      expect(strAttr(root, "langwatch.input")).toBe("List /tmp");
      expect(model.parentSpanId).toBe(root.spanId);
      expect(tool.parentSpanId).toBe(root.spanId);

      // The model span — split across batches — has BOTH input and output, plus
      // its tokens and cost (the bug this whole rework fixes).
      expect(strAttr(model, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "List /tmp" }]),
      );
      expect(strAttr(model, "gen_ai.completion")).toBe("There are 3 files.");
      expect(
        model.attributes.find((a) => a.key === "langwatch.span.cost")?.value,
      ).toEqual({ doubleValue: 0.05 });

      // The Bash tool span recovered its output from the next call's transcript.
      expect(strAttr(tool, "langwatch.input")).toBe('{"command":"ls /tmp"}');
      expect(strAttr(tool, "langwatch.output")).toBe("a.txt\nb.txt\nc.txt");

      // PII level defaults to STRICT when the logs carry no stamped level.
      expect(recorded[0]!.piiRedactionLevel).toBe("STRICT");
    });

    it("re-fires idempotently: the same logs produce the same span ids", async () => {
      const { reactor, recorded } = setup(turnRows());
      const ctx = {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      };
      await reactor.handle(logEvent(), ctx);
      const firstIds = recorded.map((r) => r.span.spanId).sort();
      recorded.length = 0;
      await reactor.handle(logEvent(), ctx);
      const secondIds = recorded.map((r) => r.span.spanId).sort();
      expect(secondIds).toEqual(firstIds);
    });
  });

  describe("the reactor gate", () => {
    it("retries when a contribution wins the race with canonical storage", async () => {
      const { reactor, getMarkedClaudeCodeLogs } = setup([]);
      await expect(
        reactor.handle(contributionEvent(), {
          tenantId: TENANT,
          aggregateId: TRACE,
          foldState: undefined,
        }),
      ).rejects.toThrow("not visible yet");
      expect(getMarkedClaudeCodeLogs).toHaveBeenCalledWith(
        TENANT,
        TRACE,
        1_700_000_000_000,
        expect.any(Number),
      );
    });

    describe("when the canonical logs never become visible", () => {
      // contributionEvent().occurredAt — the log's ingest wall-clock, which the
      // deadline measures age from.
      const CONTRIBUTION_AT = 1_800_000_000_000;
      const DEADLINE_MS = 600_000;

      it("keeps retrying while the contribution is younger than the deadline", async () => {
        const { reactor, recordSpan } = setup([], {
          visibilityDeadlineMs: DEADLINE_MS,
          now: () => CONTRIBUTION_AT + DEADLINE_MS - 1,
        });
        await expect(
          reactor.handle(contributionEvent(), {
            tenantId: TENANT,
            aggregateId: TRACE,
            foldState: undefined,
          }),
        ).rejects.toThrow("not visible yet");
        expect(recordSpan).not.toHaveBeenCalled();
      });

      it("still retries at exactly the deadline (inclusive boundary)", async () => {
        const { reactor } = setup([], {
          visibilityDeadlineMs: DEADLINE_MS,
          now: () => CONTRIBUTION_AT + DEADLINE_MS,
        });
        await expect(
          reactor.handle(contributionEvent(), {
            tenantId: TENANT,
            aggregateId: TRACE,
            foldState: undefined,
          }),
        ).rejects.toThrow("not visible yet");
      });

      /** @scenario the retry-until-visible gate gives up once a contribution outlives the deadline */
      it("gives up without retrying once the contribution outlives the deadline, so the poison group drains", async () => {
        const { reactor, recordSpan, getMarkedClaudeCodeLogs } = setup([], {
          visibilityDeadlineMs: DEADLINE_MS,
          now: () => CONTRIBUTION_AT + DEADLINE_MS + 1,
        });
        // Resolves — NOT a throw — so the group-queue completes the job instead
        // of re-staging it forever (prod incident 2026-07-20).
        await expect(
          reactor.handle(contributionEvent(), {
            tenantId: TENANT,
            aggregateId: TRACE,
            foldState: undefined,
          }),
        ).resolves.toBeUndefined();
        expect(getMarkedClaudeCodeLogs).toHaveBeenCalled();
        expect(recordSpan).not.toHaveBeenCalled();
      });
    });

    it("ignores non-log events so the spans it emits never re-trigger it", async () => {
      const { reactor, getMarkedClaudeCodeLogs, recordSpan } = setup(
        turnRows(),
      );
      const spanEvent = {
        type: SPAN_RECEIVED_EVENT_TYPE,
        tenantId: TENANT,
        aggregateId: TRACE,
        occurredAt: 1,
        data: {},
      } as unknown as SpanReceivedEvent;
      await reactor.handle(spanEvent, {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      });
      expect(getMarkedClaudeCodeLogs).not.toHaveBeenCalled();
      expect(recordSpan).not.toHaveBeenCalled();
    });

    it("ignores log events from non-claude scopes", async () => {
      const { reactor, getMarkedClaudeCodeLogs } = setup(turnRows());
      const codexLog = {
        type: LOG_RECORD_RECEIVED_EVENT_TYPE,
        tenantId: TENANT,
        aggregateId: TRACE,
        occurredAt: 1,
        data: { scopeName: "com.openai.codex.events" },
      } as unknown as LogRecordReceivedEvent;
      await reactor.handle(codexLog, {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      });
      expect(getMarkedClaudeCodeLogs).not.toHaveBeenCalled();
    });
  });

  describe("the per-turn conversion cap", () => {
    afterEach(() => {
      loggerMock.warn.mockClear();
      loggerMock.debug.mockClear();
    });

    const ctx = { tenantId: TENANT, aggregateId: TRACE, foldState: undefined };
    const rootOf = (recorded: RecordSpanCommandData[]): OtlpSpan =>
      recorded.map((r) => r.span).find((s) => s.parentSpanId === null)!;

    describe("when a turn's log count exceeds the cap", () => {
      /** @scenario "a pathological turn's span conversion is bounded" */
      it("fetches at most cap+1 records and converts only the first cap", async () => {
        // 4 model calls = 12 convertible records + 1 user_prompt = 13 rows; a
        // cap of 6 keeps the first 6 (user_prompt + first 5 model records).
        const turnLogCap = 6;
        const { reactor, getMarkedClaudeCodeLogs, recorded } = capSetup(
          manyCallTurnRows(4),
          turnLogCap,
        );

        await reactor.handle(logEvent(), ctx);

        // The read is bounded to cap+1 so an overflow is detectable without
        // materializing the whole turn.
        expect(getMarkedClaudeCodeLogs).toHaveBeenCalledWith(
          TENANT,
          TRACE,
          expect.any(Number),
          turnLogCap + 1,
        );
        // Only the capped model records became model spans: 6 kept rows minus
        // the user_prompt = 5 model records, which pair into 2 complete calls
        // (anchor #1 present) - never all 4.
        const modelSpans = recorded
          .map((r) => r.span)
          .filter((s) => spanType(s) === "llm");
        expect(modelSpans.length).toBeGreaterThan(0);
        expect(modelSpans.length).toBeLessThan(4);
      });

      /** @scenario "a pathological turn's span conversion is bounded" */
      it("marks the root span truncated with the TRUE dropped log count", async () => {
        // A pathological turn of 5000 marked logs under a cap of 2000: the fetch
        // is capped at 2001, so `fetched - cap` would report only 1. The uncapped
        // count dep returns the real 5000, so the reactor stamps 5000 - 2000.
        // 667 calls -> 2002 rows (> cap) so the overflow branch fires and queries
        // the count dep; that dep is the sole source of the true 5000 total.
        const turnLogCap = 2000;
        const countMarkedClaudeCodeLogs = vi.fn(async () => 5000);
        const { reactor, recorded } = capSetup(
          manyCallTurnRows(667),
          turnLogCap,
          countMarkedClaudeCodeLogs,
        );

        await reactor.handle(logEvent(), ctx);

        expect(countMarkedClaudeCodeLogs).toHaveBeenCalledWith(
          TENANT,
          TRACE,
          expect.any(Number),
        );
        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBe(true);
        expect(intAttr(root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBe(3000);
      });

      /** @scenario "a pathological turn's span conversion is bounded" */
      it("falls back to the lower-bound count and still stamps truncated when the count query fails", async () => {
        const turnLogCap = 6;
        const countMarkedClaudeCodeLogs = vi.fn(async () => {
          throw new Error("clickhouse unavailable");
        });
        const { reactor, recorded } = capSetup(
          manyCallTurnRows(4), // 13 rows -> fetch capped at cap+1 (7)
          turnLogCap,
          countMarkedClaudeCodeLogs,
        );

        await reactor.handle(logEvent(), ctx);

        // The truncation marker MUST still stamp, and the dropped count falls back
        // to the `fetched - cap` lower bound (7 - 6 = 1).
        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBe(true);
        expect(intAttr(root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBe(1);
        // A debug line records the count failure; the warn still fires.
        expect(loggerMock.debug).toHaveBeenCalled();
        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      });

      it("logs a structured warning naming the tenant and trace", async () => {
        // Count dep returns the real total (13 rows), cap 6 -> dropped 7.
        const { reactor } = capSetup(manyCallTurnRows(4), 6);

        await reactor.handle(logEvent(), ctx);

        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
        const [payload] = loggerMock.warn.mock.calls[0]!;
        expect(payload).toMatchObject({
          tenantId: TENANT,
          traceId: TRACE,
          turnLogCap: 6,
          droppedLogCount: 7,
        });
      });
    });

    describe("when a turn's log count is at or under the cap", () => {
      it("converts the whole turn and marks nothing truncated", async () => {
        // The full 6-row canonical turn under a generous cap.
        const { reactor, recorded } = capSetup(turnRows(), 2000);

        await reactor.handle(logEvent(), ctx);

        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBeUndefined();
        expect(intAttr(root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBeUndefined();
        // Same shape as the un-capped happy path: root + model + tool spans.
        const spans = recorded.map((r) => r.span);
        expect(spans.find((s) => spanType(s) === "agent")).toBeDefined();
        expect(spans.find((s) => spanType(s) === "llm")).toBeDefined();
        expect(spans.find((s) => spanType(s) === "tool")).toBeDefined();
      });

      it("does not warn when the turn fits under the cap", async () => {
        const { reactor } = capSetup(turnRows(), 2000);
        await reactor.handle(logEvent(), ctx);
        expect(loggerMock.warn).not.toHaveBeenCalled();
      });
    });
  });
});
