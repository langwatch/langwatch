/**
 * The hydration stage over a trace key, and over the trace-and-span pair:
 * what the message functions and `trace_json` answer with, how the reads are
 * shared between calls over the same keys, and what a span the trace does not
 * carry resolves to.
 *
 * Thread keys are in `./hydrate.unit.test.ts`; the caps, ceilings and failure
 * paths are in `./hydrateLimits.unit.test.ts`.
 *
 * @see ../hydrate.ts
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it } from "vitest";

import type { Trace } from "~/server/tracer/types";
import { hydrate, sourceOf, trace } from "./hydrateFixtures";

describe("given a finished LangWatchQL result", () => {
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

    /** @scenario "A span the trace does not hold is an unresolved key" */
    it("answers null for a span the trace does not hold, and reports it", async () => {
      const source = sourceOf({ traces: [trace({ traceId: "t1" })] });

      const result = await hydrate({
        calls: [{ column: "m", function: "llm_messages_span", options: [] }],
        columns: [{ name: "m", type: "Tuple(String, String)" }],
        rows: [{ m: ["t1", "missing"] }],
        traceSource: source,
      });

      expect(result.rows[0]?.m).toBeNull();
      // The whole key named nothing, so it is reported the same way an unknown
      // trace id is. Silence here would read as "that call carried no
      // messages".
      expect(result.unresolvedKeys).toEqual([
        { column: "m", function: "llm_messages_span", keys: 1 },
      ]);
    });

    it("reports nothing for a span that exists and carries no messages", async () => {
      const source = sourceOf({
        traces: [
          trace({
            traceId: "t1",
            spans: [
              {
                span_id: "s1",
                trace_id: "t1",
                type: "span",
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

      expect(result.rows[0]?.m).toBeNull();
      expect(result.unresolvedKeys).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Caps
  // -------------------------------------------------------------------------
});
