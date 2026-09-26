/**
 * The hydration stage over a thread key: what `conversation`,
 * `conversation_bounded` and `thread_traces` answer with, and the types the
 * result re-declares.
 *
 * Driven through a fake trace source rather than a datastore, which is exactly
 * the seam's purpose: every rule here is about what the stage does with what a
 * read returned, and none of it is about the read. The one thing a fake cannot
 * prove is that the read is tenant-scoped; that is the integration suite's job
 * (`../../__tests__/appFunctions.integration.test.ts`) and the reads go through
 * `TraceService` precisely so it can be.
 *
 * Trace and span keys are in `./hydrateTraceKeys.unit.test.ts`; the caps,
 * ceilings and failure paths are in `./hydrateLimits.unit.test.ts`.
 *
 * @see ../hydrate.ts
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it } from "vitest";

import type { Trace } from "~/server/tracer/types";
import { hydrate, sourceOf, trace } from "./hydrateFixtures";

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
});
