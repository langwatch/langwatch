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
 * instead of calling zod directly. It routes supported schemas through
 * `zod-compiler`'s real `compile()` and keeps its documented fallback cases
 * on interpreted zod (see the module docblock): `is`/`parse`/`safeParse`
 * behave correctly either way, the fallback is never silent, and compiling
 * is genuinely a one-time cost per schema.
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

  describe("given a schema using a feature the compiled backend cannot handle", () => {
    // z.custom() is one of zod-compiler's documented fallback cases (see the
    // module docblock): it compiles down to `z.any().superRefine(...)`, so
    // compileSchema skips compile() and goes straight to interpreted zod —
    // but the assertion that matters here is that it still validates
    // correctly and the fallback is recorded, not silent. A fresh schema per
    // test, since compileSchema only records the metric on the first compile
    // of a given schema object (see below) and a shared `const` here would
    // make the second test see an already-cached hit.

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
          labels: { reason: "custom" },
        },
      ]);
    });
  });

  describe("given a schema the compiled backend genuinely handles", () => {
    /** @scenario a supported schema never records a fallback */
    it("does not record a fallback metric", () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const metrics = fakeMetrics();
      compileSchema(schema, { metrics, cache: createCompiledSchemaCache() });

      expect(metrics.counterCalls).toHaveLength(0);
    });
  });

  describe("when compiling is repeated for the same unsupported schema", () => {
    /** @scenario the fallback metric fires once per schema, not once per call */
    it("does not re-record the fallback metric on a cache hit", () => {
      const schema = z.custom<`id-${string}`>(
        (value) => typeof value === "string" && value.startsWith("id-"),
      );
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

  describe("given a compiled schema and the same schema validated by interpreted zod directly", () => {
    const AGREEMENT_SCHEMAS: { label: string; schema: z.ZodTypeAny }[] = [
      { label: "object with primitives", schema: z.object({ name: z.string(), age: z.number() }) },
      { label: "coerced number", schema: z.object({ count: z.coerce.number() }) },
      {
        label: "custom validator (documented fallback)",
        schema: z.custom<`id-${string}`>(
          (value) => typeof value === "string" && value.startsWith("id-"),
        ),
      },
      {
        label: "algorithmic string format (documented fallback)",
        schema: z.string().cuid(),
      },
    ];

    const AGREEMENT_VALUES: unknown[] = [
      { name: "ada", age: 36 },
      { name: "ada", age: "36" },
      null,
      { count: "5" },
      { count: "not a number" },
      "id-123",
      "nope",
      "ch72gsb320000udocl363eof",
      "not-a-cuid",
    ];

    describe.each(AGREEMENT_SCHEMAS)("for $label", ({ schema }) => {
      const compiled = compileSchema(schema, { cache: createCompiledSchemaCache() });

      /** @scenario the compiled path and interpreted zod accept and reject the same values */
      it.each(AGREEMENT_VALUES)("agrees with interpreted zod for %j", (value) => {
        const interpreted = schema.safeParse(value);
        expect(compiled.is(value)).toBe(interpreted.success);
        expect(compiled.safeParse(value).ok).toBe(interpreted.success);
      });
    });
  });
});

describe("timeValidation", () => {
  /**
   * Only the call accounting is asserted; the two durations are deliberately
   * not compared.
   *
   * `zod-compiler` emits AOT code only once a build step has run over the
   * schema, and none runs in a vitest process (see the module docblock), so
   * under test the compiled path delegates straight back to interpreted zod.
   * A test that timed one against the other would be timing one implementation
   * against itself, and on shared CI hardware the verdict would come from
   * scheduler noise rather than from either path. The comparison is worth
   * writing where the build step actually runs — against a compiled schema,
   * not against this seam.
   */
  /** @scenario the helper runs each callback once per warm-up and once per measured iteration */
  it("runs each callback for the warm-up pass and again for the measured pass", () => {
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

    // 50 warm-up (capped at the iteration count) plus 50 measured.
    expect(compiledCalls).toBe(100);
    expect(interpretedCalls).toBe(100);
    expect(result.compiledMs).toBeTypeOf("number");
    expect(result.interpretedMs).toBeTypeOf("number");
  });

  describe("given more iterations than the warm-up cap", () => {
    /** @scenario the warm-up is bounded so a large benchmark does not double its own cost */
    it("caps the warm-up pass at 1000 iterations", () => {
      let calls = 0;

      timeValidation({
        compiled: () => {
          calls += 1;
        },
        interpreted: () => undefined,
        iterations: 2_500,
      });

      expect(calls).toBe(3_500);
    });
  });
});
