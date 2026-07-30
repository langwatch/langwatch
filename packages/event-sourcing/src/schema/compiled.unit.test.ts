import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  CounterHandle,
  HistogramHandle,
  Metrics,
  MetricLabels,
} from "../ports/metrics";
import { compileSchema, createCompiledSchemaCache, timeValidation } from "./compiled";

/**
 * `compileSchema` is the seam the rest of the package validates through
 * instead of calling zod directly. No compiled backend is wired in yet (see
 * the module docblock), so every schema here takes the fallback branch — but
 * the contract under test is the one that stays stable once a backend lands:
 * `is`/`parse`/`safeParse` behave correctly, the fallback is never silent,
 * and compiling is genuinely a one-time cost per schema.
 */

function fakeMetrics(): Metrics & {
  counterCalls: { spec: { name: string }; labels: MetricLabels | undefined }[];
} {
  const counterCalls: {
    spec: { name: string };
    labels: MetricLabels | undefined;
  }[] = [];
  return {
    counterCalls,
    counter(spec): CounterHandle {
      return {
        inc: (labels) => {
          counterCalls.push({ spec, labels });
        },
      };
    },
    histogram(): HistogramHandle {
      return { observe: () => undefined };
    },
  };
}

describe("compileSchema", () => {
  describe("given a supported schema", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const compiled = compileSchema(schema);

    /** @scenario a value matching the schema is recognised on the hot path */
    it("passes is() for a value matching the schema", () => {
      expect(compiled.is({ name: "ada", age: 36 })).toBe(true);
    });

    /** @scenario a value that violates the schema is rejected, not silently coerced */
    it("fails is() for a value violating the schema", () => {
      expect(compiled.is({ name: "ada", age: "36" })).toBe(false);
      expect(compiled.is(null)).toBe(false);
    });

    /** @scenario safeParse classifies without throwing */
    it("returns ok:false with the zod error, rather than throwing, for a bad value", () => {
      const result = compiled.safeParse({ name: "ada" });
      expect(result.ok).toBe(false);
    });

    /** @scenario safeParse hands back the parsed value on success */
    it("returns ok:true with the parsed value for a good value", () => {
      const result = compiled.safeParse({ name: "ada", age: 36 });
      expect(result).toEqual({ ok: true, value: { name: "ada", age: 36 } });
    });
  });

  describe("when parsing with coercion", () => {
    const schema = z.object({ count: z.coerce.number() });
    const compiled = compileSchema(schema);

    /** @scenario parse applies the schema's coercion, not just its shape check */
    it("coerces a numeric string into a number", () => {
      expect(compiled.parse({ count: "5" })).toEqual({ count: 5 });
    });

    /** @scenario parse still throws at a boundary that has not caught it */
    it("throws for a value coercion cannot rescue", () => {
      expect(() => compiled.parse({ count: "not a number" })).toThrow();
    });
  });

  describe("given the same schema object compiled twice", () => {
    /** @scenario compiling is memoised, not repeated per call */
    it("returns the same CompiledSchema instance", () => {
      const schema = z.string();
      const first = compileSchema(schema);
      const second = compileSchema(schema);
      expect(second).toBe(first);
    });
  });

  describe("given two schema objects with an identical shape", () => {
    /** @scenario the cache is keyed by identity, not by shape */
    it("compiles them independently", () => {
      const a = compileSchema(z.string());
      const b = compileSchema(z.string());
      expect(a).not.toBe(b);
    });
  });

  describe("given a schema using a feature the eventual compiled backend cannot handle", () => {
    // z.custom() is one of zod-compiler's documented fallback cases (ADR-099).
    // No backend is wired in yet, so this is validated the same way every
    // other schema is today — but the assertion that matters here is that it
    // still validates correctly and the fallback is recorded, not silent. A
    // fresh schema per test, since compileSchema only records the metric on
    // the first compile of a given schema object (see below) and a shared
    // `const` here would make the second test see an already-cached hit.

    /** @scenario an unsupported schema still validates correctly through the fallback */
    it("validates via the fallback rather than failing to compile", () => {
      const schema = z.custom<`id-${string}`>(
        (value) => typeof value === "string" && value.startsWith("id-"),
      );
      const compiled = compileSchema(schema, { metrics: fakeMetrics(), cache: createCompiledSchemaCache() });

      expect(compiled.is("id-123")).toBe(true);
      expect(compiled.is("nope")).toBe(false);
    });

    /** @scenario the fallback is recorded rather than degrading silently */
    it("records the fallback metric with a reason", () => {
      const schema = z.custom<`id-${string}`>(
        (value) => typeof value === "string" && value.startsWith("id-"),
      );
      const metrics = fakeMetrics();
      compileSchema(schema, { metrics, cache: createCompiledSchemaCache() });

      expect(metrics.counterCalls).toEqual([
        {
          spec: expect.objectContaining({ name: "es_schema_compile_fallback_total" }),
          labels: { reason: "compiler-unavailable" },
        },
      ]);
    });
  });

  describe("when compiling is repeated for the same schema", () => {
    /** @scenario the fallback metric fires once per schema, not once per call */
    it("does not re-record the fallback metric on a cache hit", () => {
      const schema = z.number();
      const metrics = fakeMetrics();
      // One cache across all three calls — that is the thing under test. Every
      // other test in this file takes a fresh cache so it cannot be perturbed
      // by what ran before it.
      const cache = createCompiledSchemaCache();

      compileSchema(schema, { metrics, cache });
      compileSchema(schema, { metrics, cache });
      compileSchema(schema, { metrics, cache });

      expect(metrics.counterCalls).toHaveLength(1);
    });
  });
});

describe("timeValidation", () => {
  /** @scenario the helper runs both callbacks and returns non-negative durations */
  it("measures both callbacks over the given number of iterations", () => {
    let compiledCalls = 0;
    let interpretedCalls = 0;

    const result = timeValidation({
      compiled: () => {
        compiledCalls += 1;
      },
      interpreted: () => {
        interpretedCalls += 1;
      },
      iterations: 50,
    });

    expect(compiledCalls).toBe(50 + Math.min(50, 1000));
    expect(interpretedCalls).toBe(50 + Math.min(50, 1000));
    expect(result.compiledMs).toBeGreaterThanOrEqual(0);
    expect(result.interpretedMs).toBeGreaterThanOrEqual(0);
  });

  describe("given compileSchema's is() versus calling the schema directly", () => {
    /**
     * This asserts direction only, with generous tolerance, rather than a
     * fixed speed-up factor. Wall-clock timing on shared CI hardware is
     * noisy, and today `compileSchema` literally wraps the same interpreted
     * zod call it is compared against (see the module docblock — no compiled
     * backend is wired in), so the two are expected to be close. A tight
     * bound would make this test flaky for no benefit; the risk this guards
     * against — a wrapper that reparses, re-allocates, or otherwise adds
     * real overhead per call — shows up as an order-of-magnitude gap, not a
     * few percent, so a generous multiple still catches it.
     */
    /** @scenario the compiled path is not slower than the interpreted path */
    it("is not more than a generous multiple slower than calling zod directly", () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const compiled = compileSchema(schema);
      const value = { name: "ada", age: 36 };

      const { compiledMs, interpretedMs } = timeValidation({
        compiled: () => compiled.is(value),
        interpreted: () => {
          schema.safeParse(value);
        },
        iterations: 20_000,
      });

      expect(compiledMs).toBeLessThan(Math.max(interpretedMs * 3, 50));
    });
  });
});
