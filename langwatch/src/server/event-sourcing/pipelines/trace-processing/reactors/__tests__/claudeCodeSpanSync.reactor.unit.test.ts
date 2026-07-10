import { afterEach, describe, expect, it, vi } from "vitest";

// Stable singleton logger so a test can spy the SAME `warn` fn the reactor
// module captured at import time (`const logger = createLogger(...)` runs once).
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => loggerMock,
}));

import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_DROPPED_LOG_COUNT_ATTR,
  CLAUDE_TRUNCATED_LOGS_ATTR,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import {
  type ClaudeTurnConversionState,
  deserializeClaudeTurnConversionState,
  serializeClaudeTurnConversionState,
} from "~/server/app-layer/traces/claude-code-turn-conversion.state";
import type { StoredLogRecordRow } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../schemas/constants";
import type { OtlpSpan } from "../../schemas/otlp";
import type { RecordSpanCommandData } from "../../schemas/commands";
import type {
  LogRecordReceivedEvent,
  SpanReceivedEvent,
} from "../../schemas/events";
import {
  type ClaudeTurnConversionStateStore,
  createClaudeCodeSpanSyncReactor,
} from "../claudeCodeSpanSync.reactor";

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
  attributes: { "event.name": eventName, [CLAUDE_CODE_KIND_ATTR]: "x", ...attrs },
  resourceAttributes: { "service.name": "claude-code" },
  scopeName: SCOPE,
  scopeVersion: "2.1.62",
});

// A whole tool-using turn delivered (as it really is) across batches: the
// request body lands first, the anchor + response + tool_result later, and the
// tool's output only appears in the NEXT model call's request body transcript.
const turnRows = (): StoredLogRecordRow[] => [
  row("user_prompt", { "session.id": "s", "prompt.id": "p", prompt: "List /tmp", "event.sequence": "1" }, 100, "aa00000000000001"),
  row(
    "api_request_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      "event.sequence": "2",
      body: JSON.stringify({
        model: "claude-opus-4-8",
        messages: [{ role: "user", content: [{ type: "text", text: "List /tmp" }] }],
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
      "event.sequence": "3",
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
      "event.sequence": "4",
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
      "event.sequence": "5",
      body: JSON.stringify({ content: [{ type: "text", text: "There are 3 files." }] }),
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
      "event.sequence": "6",
      body: JSON.stringify({
        model: "claude-opus-4-8",
        messages: [
          {
            role: "user",
            content: [
              { tool_use_id: "toolu_1", type: "tool_result", content: "a.txt\nb.txt\nc.txt" },
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

const spanType = (s: OtlpSpan): string | undefined =>
  (s.attributes.find((a) => a.key === "langwatch.span.type")?.value as { stringValue?: string })
    ?.stringValue;
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
// log rows, so N distinct calls make 3N convertible records for the batching
// tests.
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
      { "session.id": "s", "prompt.id": "p", prompt: "Do many things", "event.sequence": "0" },
      100,
      "aa00000000000001",
    ),
  ];
  for (let i = 0; i < calls; i++) rows.push(...modelCallRows(i));
  return rows;
};

/** In-memory conversion-state store keyed by tenant:trace, with a real
 * serialize/deserialize round-trip so the reactor exercises the persisted shape
 * (bounds + Infinity sentinels) exactly as Redis would. */
function inMemoryStateStore(): ClaudeTurnConversionStateStore & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  return {
    raw,
    async read(tenantId, traceId): Promise<ClaudeTurnConversionState | null> {
      return deserializeClaudeTurnConversionState(raw.get(`${tenantId}:${traceId}`));
    },
    async write(tenantId, traceId, state): Promise<void> {
      raw.set(`${tenantId}:${traceId}`, serializeClaudeTurnConversionState(state));
    },
  };
}

/**
 * Wires the reactor over a cursor-aware fetch: `getMarkedClaudeCodeLogs` honours
 * the `afterKey` order-key and `limit`, returning one bounded batch strictly
 * after the cursor exactly as the ClickHouse repository would. This is what lets
 * the reactor page a turn across passes in the unit test.
 */
function setup(
  rows: StoredLogRecordRow[],
  {
    turnLogCap,
    maxBatches,
    countMarkedClaudeCodeLogs,
    stateStore = inMemoryStateStore(),
  }: {
    turnLogCap?: number;
    maxBatches?: number;
    countMarkedClaudeCodeLogs?: (
      tenantId: string,
      traceId: string,
      occurredAtMs?: number,
    ) => Promise<number>;
    stateStore?: ClaudeTurnConversionStateStore & { raw?: Map<string, string> };
  } = {},
) {
  const ordered = [...rows].sort((a, b) => {
    if (a.timeUnixMs !== b.timeUnixMs) return a.timeUnixMs - b.timeUnixMs;
    const sa = Number(a.attributes["event.sequence"] ?? 0);
    const sb = Number(b.attributes["event.sequence"] ?? 0);
    return sa - sb;
  });
  const orderKey = (r: StoredLogRecordRow) => ({
    timeUnixMs: r.timeUnixMs,
    sequence: Number(r.attributes["event.sequence"] ?? 0),
  });
  const getMarkedClaudeCodeLogs = vi.fn(
    async (
      _tenantId: string,
      _traceId: string,
      _occurredAtMs?: number,
      limit?: number,
      afterKey?: { timeUnixMs: number; sequence: number },
    ) => {
      let after = ordered;
      if (afterKey) {
        after = ordered.filter((r) => {
          const k = orderKey(r);
          return (
            k.timeUnixMs > afterKey.timeUnixMs ||
            (k.timeUnixMs === afterKey.timeUnixMs && k.sequence > afterKey.sequence)
          );
        });
      }
      return typeof limit === "number" ? after.slice(0, limit) : after;
    },
  );
  const countDep = countMarkedClaudeCodeLogs ?? vi.fn(async () => rows.length);
  const recorded: RecordSpanCommandData[] = [];
  const recordSpan = vi.fn(async (data: RecordSpanCommandData) => {
    recorded.push(data);
  });
  const reactor = createClaudeCodeSpanSyncReactor({
    getMarkedClaudeCodeLogs,
    countMarkedClaudeCodeLogs: countDep,
    recordSpan,
    stateStore,
    turnLogCap,
    maxBatches,
  });
  return {
    reactor,
    getMarkedClaudeCodeLogs,
    countMarkedClaudeCodeLogs: countDep,
    recordSpan,
    recorded,
    stateStore,
  };
}

const ctx = { tenantId: TENANT, aggregateId: TRACE, foldState: undefined };
const rootOf = (recorded: RecordSpanCommandData[]): OtlpSpan =>
  recorded.map((r) => r.span).find((s) => s.parentSpanId === null)!;

describe("createClaudeCodeSpanSyncReactor", () => {
  describe("when a claude_code log is folded over the whole turn", () => {
    it("emits a root turn span with the model + tool spans as complete children", async () => {
      const { reactor, recorded } = setup(turnRows());
      await reactor.handle(logEvent(), ctx);

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
      // its tokens and cost.
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

    it("re-converts to the same span ids when the state is lost between fires", async () => {
      // Fire once with a store, capture the ids. Then re-convert the same turn
      // from a FRESH store (state lost -> cursor resets to zero, full redraw):
      // the deterministic span ids upsert the same spans.
      const first = setup(turnRows());
      await first.reactor.handle(logEvent(), ctx);
      const firstIds = first.recorded.map((r) => r.span.spanId).sort();

      const second = setup(turnRows());
      await second.reactor.handle(logEvent(), ctx);
      const secondIds = second.recorded.map((r) => r.span.spanId).sort();
      expect(secondIds).toEqual(firstIds);
    });

    it("re-firing after full conversion is a no-op (nothing new after the cursor)", async () => {
      // Convergence + efficiency: once the turn is fully converted and the cursor
      // sits past the last record, a re-fire with no new records does no work.
      const { reactor, recorded, recordSpan } = setup(turnRows());
      await reactor.handle(logEvent(), ctx);
      expect(recorded.length).toBeGreaterThan(0);
      recordSpan.mockClear();
      await reactor.handle(logEvent(), ctx);
      expect(recordSpan).not.toHaveBeenCalled();
    });

    it("persists conversion state advanced past the turn's last record", async () => {
      const { reactor, stateStore } = setup(turnRows());
      await reactor.handle(logEvent(), ctx);
      const state = await stateStore.read(TENANT, TRACE);
      expect(state).not.toBeNull();
      // The cursor advanced to the last record (time 2000, sequence 6).
      expect(state!.cursor.timeUnixMs).toBe(2_000);
    });
  });

  describe("the reactor gate", () => {
    it("ignores non-log events so the spans it emits never re-trigger it", async () => {
      const { reactor, getMarkedClaudeCodeLogs, recordSpan } = setup(turnRows());
      const spanEvent = {
        type: SPAN_RECEIVED_EVENT_TYPE,
        tenantId: TENANT,
        aggregateId: TRACE,
        occurredAt: 1,
        data: {},
      } as unknown as SpanReceivedEvent;
      await reactor.handle(spanEvent, ctx);
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
      await reactor.handle(codexLog, ctx);
      expect(getMarkedClaudeCodeLogs).not.toHaveBeenCalled();
    });
  });

  describe("incremental batching across passes", () => {
    afterEach(() => {
      loggerMock.warn.mockClear();
      loggerMock.debug.mockClear();
    });

    describe("given a turn larger than one batch", () => {
      /** @scenario "a large turn converts fully across bounded batches" */
      it("converts the whole turn across multiple batches in one job (converges)", async () => {
        // 4 model calls = 12 records + 1 user_prompt = 13 rows; a batch of 5 pages
        // the turn in 3 batches within one job (maxBatches high enough).
        const { reactor, recorded, getMarkedClaudeCodeLogs } = setup(
          manyCallTurnRows(4),
          { turnLogCap: 5, maxBatches: 25 },
        );

        await reactor.handle(logEvent(), ctx);

        // Paged in bounded batches, each fetch after the prior cursor.
        expect(getMarkedClaudeCodeLogs.mock.calls.length).toBeGreaterThan(1);
        for (const call of getMarkedClaudeCodeLogs.mock.calls) {
          expect(call[3]).toBe(5); // limit == turnLogCap on every fetch
        }
        // All 4 model calls converged (whole turn converted, not truncated).
        const modelSpans = recorded
          .map((r) => r.span)
          .filter((s) => spanType(s) === "llm");
        expect(new Set(modelSpans.map((s) => s.spanId)).size).toBe(4);
        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBeUndefined();
      });
    });

    describe("given the per-job batch ceiling stops the loop before the turn drains", () => {
      /** @scenario "a large turn converts fully across bounded batches" */
      it("stamps the root truncated with the TRUE remaining count", async () => {
        // 667 calls -> 2002 records (+prompt) . A batch of 2000 with maxBatches 1
        // converts the first batch only, so the job exits still behind.
        const turnLogCap = 2000;
        const countMarkedClaudeCodeLogs = vi.fn(async () => 5000);
        const { reactor, recorded } = setup(manyCallTurnRows(667), {
          turnLogCap,
          maxBatches: 1,
          countMarkedClaudeCodeLogs,
        });

        await reactor.handle(logEvent(), ctx);

        expect(countMarkedClaudeCodeLogs).toHaveBeenCalledWith(
          TENANT,
          TRACE,
          expect.any(Number),
        );
        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBe(true);
        // TRUE remaining = total (5000) minus what one batch of 2000 converted.
        expect(intAttr(root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBeGreaterThan(0);
        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      });

      /** @scenario "a large turn converts fully across bounded batches" */
      it("falls back to a lower-bound remaining count when the count query fails", async () => {
        const turnLogCap = 5;
        const countMarkedClaudeCodeLogs = vi.fn(async () => {
          throw new Error("clickhouse unavailable");
        });
        const { reactor, recorded } = setup(manyCallTurnRows(4), {
          turnLogCap,
          maxBatches: 1,
          countMarkedClaudeCodeLogs,
        });

        await reactor.handle(logEvent(), ctx);

        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBe(true);
        // Lower bound: at least one more batch (turnLogCap) remains.
        expect(intAttr(root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBe(turnLogCap);
        expect(loggerMock.debug).toHaveBeenCalled();
        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      });
    });

    describe("given a job left the turn behind, then a later job resumes it", () => {
      /** @scenario "a large turn converts fully across bounded batches" */
      it("clears the truncation marker and completes the conversion", async () => {
        // 5 model calls = 15 records + prompt = 16 rows. A batch of 4 with
        // maxBatches 3 converts 12 rows in job 1 (behind); the next job resumes
        // from the cursor and drains the rest, clearing the marker.
        const rows = manyCallTurnRows(5);
        const stateStore = inMemoryStateStore();
        const { reactor, recorded } = setup(rows, {
          turnLogCap: 4,
          maxBatches: 3,
          stateStore,
        });

        // Job 1: behind (3 batches of 4 = 12 of 16 rows), truncation stamped.
        await reactor.handle(logEvent(), ctx);
        const job1Root = rootOf(recorded);
        expect(boolAttr(job1Root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBe(true);

        // Job 2: resumes from the persisted cursor, drains the remaining rows,
        // and re-emits the root WITHOUT the truncation marker (value flips).
        recorded.length = 0;
        await reactor.handle(logEvent(), ctx);
        const job2Root = rootOf(recorded);
        expect(boolAttr(job2Root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBeUndefined();
        expect(intAttr(job2Root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBeUndefined();
        // Same root span id across jobs (idempotent upsert).
        expect(job2Root.spanId).toBe(job1Root.spanId);
      });
    });

    describe("given the conversion state is missing (lost Redis key)", () => {
      it("resets the cursor to zero and re-converts the turn from the start", async () => {
        const { reactor, recorded, getMarkedClaudeCodeLogs } = setup(turnRows(), {
          // A store that always reads null (lost state) but accepts writes.
          stateStore: {
            async read() {
              return null;
            },
            async write() {},
          },
        });

        await reactor.handle(logEvent(), ctx);

        // The first fetch has no afterKey (cursor reset to zero -> from the start).
        expect(getMarkedClaudeCodeLogs.mock.calls[0]![4]).toBeUndefined();
        // The full turn still converged: root + model + tool present.
        const spans = recorded.map((r) => r.span);
        expect(spans.find((s) => spanType(s) === "agent")).toBeDefined();
        expect(spans.find((s) => spanType(s) === "llm")).toBeDefined();
        expect(spans.find((s) => spanType(s) === "tool")).toBeDefined();
      });
    });

    describe("given a turn that fits in one batch", () => {
      it("converts the whole turn and marks nothing truncated", async () => {
        const { reactor, recorded } = setup(turnRows(), { turnLogCap: 2000 });

        await reactor.handle(logEvent(), ctx);

        const root = rootOf(recorded);
        expect(boolAttr(root, CLAUDE_TRUNCATED_LOGS_ATTR)).toBeUndefined();
        expect(intAttr(root, CLAUDE_DROPPED_LOG_COUNT_ATTR)).toBeUndefined();
        const spans = recorded.map((r) => r.span);
        expect(spans.find((s) => spanType(s) === "agent")).toBeDefined();
        expect(spans.find((s) => spanType(s) === "llm")).toBeDefined();
        expect(spans.find((s) => spanType(s) === "tool")).toBeDefined();
      });

      it("does not warn when the turn fits under one batch", async () => {
        const { reactor } = setup(turnRows(), { turnLogCap: 2000 });
        await reactor.handle(logEvent(), ctx);
        expect(loggerMock.warn).not.toHaveBeenCalled();
      });
    });
  });
});
