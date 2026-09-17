/**
 * The hydration stage: caps, truncation, unresolved keys, and the types it
 * re-declares.
 *
 * Driven through a fake trace source rather than a datastore, which is exactly
 * the seam's purpose — every rule here is about what the stage does with what a
 * read returned, and none of it is about the read. The one thing a fake cannot
 * prove is that the read is tenant-scoped; that is the integration suite's job
 * (`../../__tests__/appFunctions.integration.test.ts`) and the reads go through
 * `TraceService` precisely so it can be.
 *
 * @see ../hydrate.ts
 * @see specs/analytics/lwql-app-functions.feature
 */
import { describe, expect, it } from "vitest";
import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { LWQL_APP_FUNCTION_KEY_CAPS } from "../catalog";
import {
  hydrateLangWatchQLAppFunctions,
  type LangWatchQLHydrationLimits,
} from "../hydrate";
import type { LangWatchQLAppFunctionTraceSource } from "../traceSource";

const PROTECTIONS: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
} as Protections;

const LIMITS: LangWatchQLHydrationLimits = {
  maxHydratedBytes: 32_000_000,
  maxHydratedValueBytes: 4_000_000,
};

/** A trace carrying trace-level text, which is what the drawer reads first. */
function trace({
  traceId,
  threadKey,
  input = "hello",
  output = "hi there",
  startedAt = 1_700_000_000_000,
  spans = [],
}: {
  traceId: string;
  threadKey?: string;
  input?: string;
  output?: string;
  startedAt?: number;
  spans?: Trace["spans"];
}): Trace {
  return {
    trace_id: traceId,
    project_id: "project-a",
    metadata: threadKey === undefined ? {} : { thread_id: threadKey },
    timestamps: {
      started_at: startedAt,
      inserted_at: startedAt,
      updated_at: startedAt,
    },
    ...(input === "" ? {} : { input: { value: input } }),
    ...(output === "" ? {} : { output: { value: output } }),
    spans,
  } as Trace;
}

/** A source answering from two fixed lists, and counting what it was asked. */
function sourceOf({
  traces = [],
  threadTraces = [],
}: {
  traces?: Trace[];
  threadTraces?: Trace[];
} = {}): LangWatchQLAppFunctionTraceSource & {
  askedTraceIds: string[][];
  askedThreadKeys: string[][];
} {
  const askedTraceIds: string[][] = [];
  const askedThreadKeys: string[][] = [];
  return {
    askedTraceIds,
    askedThreadKeys,
    async tracesByIds({ traceIds }) {
      askedTraceIds.push([...traceIds]);
      return traces.filter((candidate) =>
        traceIds.includes(candidate.trace_id),
      );
    },
    async tracesByThreadKeys({ threadKeys }) {
      askedThreadKeys.push([...threadKeys]);
      return threadTraces.filter((candidate) => {
        const key = candidate.metadata.thread_id;
        return typeof key === "string" && threadKeys.includes(key);
      });
    },
  };
}

const hydrate = (input: {
  calls: Parameters<typeof hydrateLangWatchQLAppFunctions>[0]["calls"];
  columns: Parameters<typeof hydrateLangWatchQLAppFunctions>[0]["columns"];
  rows: Record<string, unknown>[];
  traceSource: LangWatchQLAppFunctionTraceSource;
  limits?: LangWatchQLHydrationLimits;
}) =>
  hydrateLangWatchQLAppFunctions({
    projectId: "project-a",
    protections: PROTECTIONS,
    limits: input.limits ?? LIMITS,
    ...input,
  });

describe("given a finished LangWatchQL result", () => {
  describe("when the statement called no app function", () => {
    it("returns the same rows and columns, and reads nothing", async () => {
      const source = sourceOf();
      const rows = [{ TraceId: "t1" }];
      const columns = [{ name: "TraceId", type: "String" }];

      const result = await hydrate({
        calls: [],
        columns,
        rows,
        traceSource: source,
      });

      expect(result.rows).toBe(rows);
      expect(result.columns).toBe(columns);
      expect(source.askedTraceIds).toEqual([]);
      expect(source.askedThreadKeys).toEqual([]);
    });
  });

  describe("when a thread-keyed call is hydrated", () => {
    /** @scenario "The hydrated column carries the rendered conversation, not the thread key" */
    it("replaces the key with the rendered transcript and re-declares the type", async () => {
      const source = sourceOf({
        threadTraces: [
          trace({ traceId: "t1", threadKey: "c1", input: "first question" }),
          trace({
            traceId: "t2",
            threadKey: "c1",
            input: "second question",
            startedAt: 1_700_000_060_000,
          }),
        ],
      });

      const result = await hydrate({
        calls: [
          { column: "transcript", function: "conversation", options: [] },
        ],
        columns: [{ name: "transcript", type: "Nullable(String)" }],
        rows: [{ transcript: "c1" }],
        traceSource: source,
      });

      const transcript = result.rows[0]?.transcript;
      expect(typeof transcript).toBe("string");
      expect(transcript).toContain("first question");
      expect(transcript).toContain("second question");
      expect(transcript).toContain("Turn 1");
      expect(result.columns).toEqual([
        { name: "transcript", type: "Nullable(String)" },
      ]);
    });

    it("answers thread_traces with the thread's trace ids, oldest first", async () => {
      const source = sourceOf({
        threadTraces: [
          trace({
            traceId: "later",
            threadKey: "c1",
            startedAt: 1_700_000_060_000,
          }),
          trace({ traceId: "earlier", threadKey: "c1" }),
        ],
      });

      const result = await hydrate({
        calls: [{ column: "ids", function: "thread_traces", options: [] }],
        columns: [{ name: "ids", type: "Nullable(String)" }],
        rows: [{ ids: "c1" }],
        traceSource: source,
      });

      expect(result.rows[0]?.ids).toEqual(["earlier", "later"]);
      expect(result.columns).toEqual([{ name: "ids", type: "Array(String)" }]);
    });

    /** @scenario "A bounded conversation keeps both ends and names what it dropped" */
    it("honours the token budget and says what it dropped", async () => {
      // Sized so twelve turns overrun the budget while a single turn is a
      // small fraction of it, which is the shape the renderer's head-and-tail
      // rule is for. One turn large enough to eat the whole budget by itself
      // keeps the opening and nothing else, which is a different scenario.
      const long = "x".repeat(1_000);
      const source = sourceOf({
        threadTraces: Array.from({ length: 12 }, (_unused, index) =>
          trace({
            traceId: `t${index}`,
            threadKey: "c1",
            input: `${index === 0 ? "opening" : index === 11 ? "closing" : "middle"} ${long}`,
            startedAt: 1_700_000_000_000 + index * 60_000,
          }),
        ),
      });

      const result = await hydrate({
        calls: [
          {
            column: "transcript",
            function: "conversation_bounded",
            options: [2_000, ""],
          },
        ],
        columns: [{ name: "transcript", type: "Nullable(String)" }],
        rows: [{ transcript: "c1" }],
        traceSource: source,
      });

      const transcript = String(result.rows[0]?.transcript);
      expect(transcript).toContain("omitted to fit the token budget");
      expect(transcript).toContain("opening");
      expect(transcript).toContain("closing");
    });

    it("stops at until_trace_id so a judgement reads only what had happened", async () => {
      const source = sourceOf({
        threadTraces: [
          trace({ traceId: "t1", threadKey: "c1", input: "before" }),
          trace({
            traceId: "t2",
            threadKey: "c1",
            input: "after",
            startedAt: 1_700_000_060_000,
          }),
        ],
      });

      const result = await hydrate({
        calls: [
          {
            column: "transcript",
            function: "conversation_bounded",
            options: [8_000, "t1"],
          },
        ],
        columns: [{ name: "transcript", type: "Nullable(String)" }],
        rows: [{ transcript: "c1" }],
        traceSource: source,
      });

      const transcript = String(result.rows[0]?.transcript);
      expect(transcript).toContain("before");
      expect(transcript).not.toContain("after");
    });

    /** @scenario "A turn with no computed content falls back to the trace's LLM span messages" */
    it("reads the LLM span's messages when the trace carries no computed text", async () => {
      const source = sourceOf({
        threadTraces: [
          trace({
            traceId: "t1",
            threadKey: "c1",
            input: "",
            output: "",
            spans: [
              {
                span_id: "s1",
                trace_id: "t1",
                type: "llm",
                input: {
                  type: "chat_messages",
                  value: [
                    { role: "user", content: "what is the refund window" },
                  ],
                },
                output: {
                  type: "chat_messages",
                  value: [{ role: "assistant", content: "thirty days" }],
                },
              },
            ] as unknown as Trace["spans"],
          }),
        ],
      });

      const result = await hydrate({
        calls: [
          { column: "transcript", function: "conversation", options: [] },
        ],
        columns: [{ name: "transcript", type: "Nullable(String)" }],
        rows: [{ transcript: "c1" }],
        traceSource: source,
      });

      const transcript = String(result.rows[0]?.transcript);
      expect(transcript).toContain("what is the refund window");
      expect(transcript).toContain("thirty days");
    });
  });

  describe("when a trace-keyed call is hydrated", () => {
    it("answers llm_messages with JSON holding both sides", async () => {
      const source = sourceOf({
        traces: [trace({ traceId: "t1", input: "ask", output: "answer" })],
      });

      const result = await hydrate({
        calls: [{ column: "m", function: "llm_messages", options: [] }],
        columns: [{ name: "m", type: "Nullable(String)" }],
        rows: [{ m: "t1" }],
        traceSource: source,
      });

      const parsed = JSON.parse(String(result.rows[0]?.m));
      expect(parsed).toHaveProperty("input");
      expect(parsed).toHaveProperty("output");
    });

    it("answers llm_input_messages with a bare array", async () => {
      const source = sourceOf({
        traces: [trace({ traceId: "t1", input: "ask", output: "answer" })],
      });

      const result = await hydrate({
        calls: [{ column: "m", function: "llm_input_messages", options: [] }],
        columns: [{ name: "m", type: "Nullable(String)" }],
        rows: [{ m: "t1" }],
        traceSource: source,
      });

      expect(Array.isArray(JSON.parse(String(result.rows[0]?.m)))).toBe(true);
    });

    it("answers trace_json with the whole trace", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: "t1" }],
        traceSource: source,
      });

      expect(JSON.parse(String(result.rows[0]?.j))).toHaveProperty(
        "trace_id",
        "t1",
      );
    });

    it("reads each distinct key once, however many rows repeat it", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: Array.from({ length: 50 }, () => ({ j: "t1" })),
        traceSource: source,
      });

      expect(source.askedTraceIds).toEqual([["t1"]]);
    });

    it("shares one read between two calls over the same keys", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      await hydrate({
        calls: [
          { column: "a", function: "llm_messages", options: [] },
          { column: "b", function: "trace_json", options: [] },
        ],
        columns: [
          { name: "a", type: "Nullable(String)" },
          { name: "b", type: "Nullable(String)" },
        ],
        rows: [{ a: "t1", b: "t1" }],
        traceSource: source,
      });

      expect(source.askedTraceIds).toEqual([["t1"]]);
    });
  });

  describe("when the key is a pair", () => {
    it("reads both halves out of the tuple the database returned", async () => {
      const source = sourceOf({
        traces: [
          trace({
            traceId: "t1",
            spans: [
              {
                span_id: "s1",
                trace_id: "t1",
                type: "llm",
                input: {
                  type: "chat_messages",
                  value: [{ role: "user", content: "hi" }],
                },
                output: { type: "text", value: "hello" },
                timestamps: { started_at: 1, finished_at: 2 },
              },
            ] as unknown as Trace["spans"],
          }),
        ],
      });

      const result = await hydrate({
        calls: [{ column: "m", function: "llm_messages_span", options: [] }],
        columns: [{ name: "m", type: "Tuple(String, String)" }],
        rows: [{ m: ["t1", "s1"] }],
        traceSource: source,
      });

      expect(result.rows[0]?.m).toContain("hello");
      expect(result.columns).toEqual([{ name: "m", type: "Nullable(String)" }]);
    });

    it("answers null for a span the trace does not hold", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      const result = await hydrate({
        calls: [{ column: "m", function: "llm_messages_span", options: [] }],
        columns: [{ name: "m", type: "Tuple(String, String)" }],
        rows: [{ m: ["t1", "missing"] }],
        traceSource: source,
      });

      expect(result.rows[0]?.m).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Caps
  // -------------------------------------------------------------------------

  describe("when one execution needs more distinct keys than its cap", () => {
    /** @scenario "More distinct thread keys than the thread cap allows is refused the same way" */
    it("refuses with the key-cap error rather than hydrating some of them", async () => {
      const source = sourceOf();
      const rows = Array.from(
        { length: LWQL_APP_FUNCTION_KEY_CAPS.thread + 1 },
        (_unused, index) => ({ transcript: `c${index}` }),
      );

      await expect(
        hydrate({
          calls: [
            { column: "transcript", function: "conversation", options: [] },
          ],
          columns: [{ name: "transcript", type: "Nullable(String)" }],
          rows,
          traceSource: source,
        }),
      ).rejects.toMatchObject({ code: "lwql_app_function_key_cap" });
    });

    /** @scenario "More distinct trace keys than the cap allows is a refusal, not a partial answer" */
    it("names the cap and the key kind that broke it", async () => {
      const rows = Array.from(
        { length: LWQL_APP_FUNCTION_KEY_CAPS.trace + 1 },
        (_unused, index) => ({ j: `t${index}` }),
      );

      const failure = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows,
        traceSource: sourceOf(),
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "lwql_app_function_key_cap",
        meta: {
          keyKind: "trace",
          cap: LWQL_APP_FUNCTION_KEY_CAPS.trace,
          distinct: LWQL_APP_FUNCTION_KEY_CAPS.trace + 1,
        },
      });
    });

    it("reads nothing at all, because the cap is checked before the fetch", async () => {
      const source = sourceOf();
      const rows = Array.from(
        { length: LWQL_APP_FUNCTION_KEY_CAPS.trace + 1 },
        (_unused, index) => ({ j: `t${index}` }),
      );

      await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows,
        traceSource: source,
      }).catch(() => undefined);

      expect(source.askedTraceIds).toEqual([]);
    });

    /** @scenario "Repeated keys cost nothing against the cap" */
    it("counts distinct keys, so a repeated one costs nothing", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });
      const rows = Array.from(
        { length: LWQL_APP_FUNCTION_KEY_CAPS.trace + 10 },
        () => ({ j: "t1" }),
      );

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows,
        traceSource: source,
      });

      expect(result.rows).toHaveLength(rows.length);
    });
  });

  // -------------------------------------------------------------------------
  // Unresolved keys, truncation
  // -------------------------------------------------------------------------

  describe("when a key names nothing", () => {
    /** @scenario "A key that resolves to nothing hydrates to null and is reported" */
    it("hydrates to null and reports the count", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: "t1" }, { j: "gone" }, { j: "also-gone" }],
        traceSource: source,
      });

      expect(result.rows[1]?.j).toBeNull();
      expect(result.unresolvedKeys).toEqual([
        { column: "j", function: "trace_json", keys: 2 },
      ]);
    });

    /** @scenario "A null key is not an unresolved key" */
    it("treats a null or empty key as no key at all, and reports nothing", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: null }, { j: "" }],
        traceSource: source,
      });

      expect(result.rows.map((row) => row.j)).toEqual([null, null]);
      expect(result.unresolvedKeys).toEqual([]);
      expect(source.askedTraceIds).toEqual([[]]);
    });
  });

  describe("when a single value is larger than the per-value ceiling", () => {
    /** @scenario "A single value past the per-value ceiling is cut and reported" */
    it("cuts that value and reports which function produced it", async () => {
      const source = sourceOf({
        traces: [trace({ traceId: "t1", input: "y".repeat(5_000) })],
      });

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: "t1" }],
        traceSource: source,
        limits: { ...LIMITS, maxHydratedValueBytes: 1_000 },
      });

      expect(String(result.rows[0]?.j).length).toBeLessThanOrEqual(1_000);
      expect(result.valueTruncations).toEqual([
        { column: "j", function: "trace_json", values: 1 },
      ]);
    });
  });

  describe("when the hydrated result passes the byte ceiling", () => {
    /** @scenario "A hydrated result past the byte ceiling drops trailing rows and says so" */
    it("drops trailing rows and reports the ceiling", async () => {
      const source = sourceOf({
        traces: [
          trace({ traceId: "t1", input: "a".repeat(2_000) }),
          trace({ traceId: "t2", input: "b".repeat(2_000) }),
          trace({ traceId: "t3", input: "c".repeat(2_000) }),
        ],
      });

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: "t1" }, { j: "t2" }, { j: "t3" }],
        traceSource: source,
        limits: { ...LIMITS, maxHydratedBytes: 4_000 },
      });

      expect(result.truncatedByBytes).toBe(true);
      expect(result.rows.length).toBeLessThan(3);
      expect(result.rows[0]?.j).toContain("a".repeat(100));
    });

    it("keeps every row when the ceiling is not reached", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      const result = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: "t1" }],
        traceSource: source,
      });

      expect(result.truncatedByBytes).toBe(false);
      expect(result.rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Failure
  // -------------------------------------------------------------------------

  describe("when the read fails", () => {
    /** @scenario "A failed fetch is a platform failure, not a wrong answer" */
    it("refuses with the hydration failure rather than answering with nulls", async () => {
      const source: LangWatchQLAppFunctionTraceSource = {
        async tracesByIds() {
          throw new Error("clickhouse is having a day");
        },
        async tracesByThreadKeys() {
          return [];
        },
      };

      const failure = await hydrate({
        calls: [{ column: "j", function: "trace_json", options: [] }],
        columns: [{ name: "j", type: "Nullable(String)" }],
        rows: [{ j: "t1" }],
        traceSource: source,
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "lwql_app_function_hydration_failed",
        fault: "platform",
      });
    });
  });

  describe("when the plan names a function the catalog does not have", () => {
    it("throws a plain error, because that is our bug and not the caller's", async () => {
      await expect(
        hydrate({
          calls: [{ column: "x", function: "not_a_function", options: [] }],
          columns: [{ name: "x", type: "Nullable(String)" }],
          rows: [{ x: "t1" }],
          traceSource: sourceOf(),
        }),
      ).rejects.toThrow(/not an app function/);
    });
  });
});
