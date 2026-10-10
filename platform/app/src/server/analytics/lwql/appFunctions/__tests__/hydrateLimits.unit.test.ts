/**
 * The hydration stage's ceilings and refusals: the key caps, the per-value and
 * whole-result byte ceilings, keys that name nothing, and what happens when a
 * read or a plan is wrong.
 *
 * Every one of these is about a result a caller must never mistake for a
 * complete one, which is why each asserts on what was reported rather than
 * only on what came back.
 *
 * @see ../hydrate.ts
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it } from "vitest";

import { LWQL_APP_FUNCTION_KEY_CAPS } from "../catalog";
import type { LangWatchQLAppFunctionTraceSource } from "../traceSource";
import { hydrate, LIMITS, sourceOf, trace } from "./hydrateFixtures";

describe("given a finished LangWatchQL result", () => {
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

    /** @scenario "More distinct trace keys than the cap allows is a refusal, not a partial answer" */
    it("names the span function whose trace ids helped break the trace cap", async () => {
      // 600 trace keys and 600 span pairs on other traces: under the span cap,
      // but 1,200 distinct trace ids between them, so the refusal is the trace
      // cap's and both calls are named as the ones that cost it.
      const half = LWQL_APP_FUNCTION_KEY_CAPS.trace / 2 + 100;
      const rows = Array.from({ length: half }, (_unused, index) => ({
        j: `t${index}`,
        m: [`t${index + half}`, "s1"],
      }));

      const failure = await hydrate({
        calls: [
          { column: "j", function: "trace_json", options: [] },
          { column: "m", function: "llm_messages_span", options: [] },
        ],
        columns: [
          { name: "j", type: "Nullable(String)" },
          { name: "m", type: "Tuple(String, String)" },
        ],
        rows,
        traceSource: sourceOf(),
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "lwql_app_function_key_cap",
        meta: {
          keyKind: "trace",
          distinct: half * 2,
          functions: ["llm_messages_span", "trace_json"],
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
      expect(source.askedTraceIds).toEqual([]);
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

      expect(result.isTruncatedByBytes).toBe(true);
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

      expect(result.isTruncatedByBytes).toBe(false);
      expect(result.rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Failure
  // -------------------------------------------------------------------------

  describe("when the hydrated content is not ASCII", () => {
    /** @scenario "The result ceiling counts encoded bytes, not characters" */
    it("counts encoded bytes, so a multi-byte transcript is held to the same ceiling", async () => {
      // Three bytes per character in UTF-8, one UTF-16 code unit each. A
      // ceiling measured in code units would let this result run to three
      // times the bytes it is allowed.
      const wide = "\u4f60".repeat(400);
      const source = sourceOf({
        threadTraces: [
          trace({ traceId: "t1", threadKey: "c1", input: wide }),
          trace({ traceId: "t2", threadKey: "c2", input: wide }),
        ],
      });

      const result = await hydrate({
        calls: [
          { column: "transcript", function: "conversation", options: [] },
        ],
        columns: [{ name: "transcript", type: "Nullable(String)" }],
        rows: [{ transcript: "c1" }, { transcript: "c2" }],
        traceSource: source,
        limits: { ...LIMITS, maxHydratedBytes: 2_000 },
      });

      expect(result.rows).toHaveLength(1);
      expect(result.isTruncatedByBytes).toBe(true);
    });
  });

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
