import type { z } from "zod";
import { noopMetrics } from "../ports/metrics";
import type { Metrics } from "../ports/metrics";

/**
 * The seam between the package and zod's interpreter.
 *
 * Every stored fold state is decoded on read, and every event payload is
 * validated before `apply` sees it, so validation cost is paid per event on
 * the busiest streams. Interpreted zod pays that cost with a tree-walking
 * interpreter; ADR-099 already made this trade once for the storage codec,
 * choosing `zod-compiler` there because its sync-transform schemas compile to
 * generated code (2-43x over interpreted zod, per its own benchmarks) and its
 * documented fallbacks — `.check()`, async transforms, `z.custom()`,
 * `z.instanceof()`, algorithmic string formats, object intersections, dynamic
 * error maps — are features neither a column decoder nor an event payload has
 * reason to use.
 *
 * This module is that same seam for the core: the rest of the package calls
 * `compileSchema` and never imports `zod` for validation directly, so the
 * day a compiled backend is wired in, every call site benefits without a
 * change.
 *
 * **That day has not arrived yet.** `zod-compiler` is not a declared
 * dependency of this package and is not installed in this workspace.
 * Wiring it in requires either a static `import` — which makes it a hard
 * dependency the package cannot work without, the opposite of "optional" —
 * or a dynamic `import()` to load it only when present, which this
 * repository's convention bans outside the CLI's own boot path. Neither is
 * available to this change. `compileSchema` below therefore always takes the
 * fallback branch: every schema is validated through interpreted zod, and
 * every compile records that fact on the fallback metric so the gap stays
 * visible on a dashboard rather than silently costing throughput. The
 * `is`/`parse`/`safeParse` contract does not change when a backend lands —
 * only the body of the `compiled` object below does.
 */

/**
 * The validator produced for one schema. `is` and `safeParse` never throw;
 * `parse` throws exactly as `z.ZodType.parse` does, because it exists for
 * boundaries that already handle a thrown parse error.
 */
export interface CompiledSchema<T> {
  /** Allocation-free shape check. Use on the hot path. */
  is(value: unknown): value is T;
  /** Full parse with coercion. Use at a boundary, not per event. */
  parse(value: unknown): T;
  /** Non-throwing parse for paths that classify rather than fail. */
  safeParse(value: unknown): { ok: true; value: T } | { ok: false; error: unknown };
}

/** The reason a schema took the fallback branch. There is only one today —
 * see the module docblock — but the label exists so a wired-in backend can
 * report `"unsupported-feature"` etc. without a metric-shape change. */
const FALLBACK_REASON_COMPILER_UNAVAILABLE = "compiler-unavailable";

/**
 * Compiled schemas, keyed by the schema object itself.
 *
 * A `WeakMap` rather than a `Map`: the key is a zod schema, and schemas are
 * typically declared once and held for the life of the process, but a schema
 * built inside a torn-down pipeline (a test, a short-lived worker) must be
 * collectable when nothing else references it. A `Map` would pin every schema
 * ever compiled for the life of the module, turning this cache into a leak in
 * exactly the code paths that build and discard aggregates most often.
 */
export type CompiledSchemaCache = WeakMap<z.ZodTypeAny, CompiledSchema<unknown>>;

/**
 * The process-wide cache. Weak so a schema held only by a torn-down pipeline is
 * collectable rather than pinned for the life of the process.
 *
 * It is injectable because a module-level memo makes callers order-dependent:
 * whether a compile records its fallback metric depends on whether some earlier
 * caller happened to compile the same schema object first. That is invisible in
 * production and it makes tests pass alone and fail together, which is the worst
 * combination — the failure looks like flakiness rather than shared state.
 */
export function createCompiledSchemaCache(): CompiledSchemaCache {
  return new WeakMap();
}

const compiledCache: CompiledSchemaCache = createCompiledSchemaCache();

/**
 * Compiles `schema` into a `CompiledSchema`, or returns the one already built
 * for this exact schema object.
 *
 * **Call this once per schema** — at module scope next to the schema's
 * declaration, or when an aggregate is built — and hold the result. The
 * memoisation makes a second call for the same schema instance cheap, but a
 * caller that reconstructs the schema itself on every event (`z.object({...})`
 * inside a hot function) defeats it: a fresh schema object is a fresh cache
 * miss no matter how identical its shape.
 *
 * `deps.metrics` is optional and, like the rest of the package, defaults to a
 * no-op. It is read only on the first compile of a given schema — a cache hit
 * never re-records the fallback metric, because the fallback decision itself
 * is made once, at compile time, not on every validation.
 */
export function compileSchema<T>(
  schema: z.ZodType<T>,
  deps: { metrics?: Metrics; cache?: CompiledSchemaCache } = {},
): CompiledSchema<T> {
  const cache = deps.cache ?? compiledCache;
  const cached = cache.get(schema);
  if (cached !== undefined) {
    // The cache is keyed by object identity across every T this module ever
    // compiles, so a `WeakMap<z.ZodTypeAny, CompiledSchema<unknown>>` cannot
    // itself carry the phantom type. `T` is fixed by the schema the original
    // caller passed in as `z.ZodType<T>`; this lookup returns exactly what
    // that call produced, so recovering `T` here is safe even though the map
    // cannot express it.
    return cached as CompiledSchema<T>;
  }

  const metrics = deps.metrics ?? noopMetrics;
  metrics
    .counter({
      name: "es_schema_compile_fallback_total",
      help: "Schemas compiled via the interpreted zod fallback instead of a compiled backend, by reason.",
      labelNames: ["reason"],
    })
    .inc({ reason: FALLBACK_REASON_COMPILER_UNAVAILABLE });

  const compiled: CompiledSchema<T> = {
    is(value): value is T {
      return schema.safeParse(value).success;
    },
    parse(value): T {
      return schema.parse(value);
    },
    safeParse(value) {
      const result = schema.safeParse(value);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, error: result.error };
    },
  };

  // Justified for the same reason as the read above: the map's value type
  // erases T, and this is the one place that erasure is introduced.
  cache.set(schema, compiled as CompiledSchema<unknown>);
  return compiled;
}

/** Wall-clock cost of validating with the compiled path versus calling the
 * interpreted schema directly, over the same number of iterations. */
export interface ValidationTiming {
  readonly compiledMs: number;
  readonly interpretedMs: number;
}

/**
 * Times `compiled` against `interpreted` over `iterations` runs each, after a
 * shared warm-up pass so the numbers reflect steady-state cost rather than
 * first-call allocation or JIT warm-up.
 *
 * Returns raw durations rather than a verdict. What counts as "acceptable" is
 * a test-authoring decision — see `compiled.unit.test.ts` for why that
 * assertion checks direction only, with generous tolerance, rather than a
 * fixed speed-up factor.
 */
export function timeValidation(args: {
  compiled: () => void;
  interpreted: () => void;
  iterations: number;
}): ValidationTiming {
  const warmupIterations = Math.min(args.iterations, 1000);
  for (let i = 0; i < warmupIterations; i++) {
    args.compiled();
    args.interpreted();
  }

  const compiledStart = performance.now();
  for (let i = 0; i < args.iterations; i++) args.compiled();
  const compiledMs = performance.now() - compiledStart;

  const interpretedStart = performance.now();
  for (let i = 0; i < args.iterations; i++) args.interpreted();
  const interpretedMs = performance.now() - interpretedStart;

  return { compiledMs, interpretedMs };
}
