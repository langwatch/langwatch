import type { z } from "zod";
import { compile, isCompiledSchema } from "zod-compiler";
import { noopMetrics } from "../ports/metrics";
import type { Metrics } from "../ports/metrics";

/**
 * The seam between the package and zod's interpreter.
 *
 * Every stored fold state is decoded on read, and every event payload is
 * validated before `apply` sees it, so validation cost is paid per event on
 * the busiest streams. Interpreted zod pays that cost with a tree-walking
 * interpreter; `zod-compiler` compiles sync-transform schemas to generated
 * code instead (2-43x over interpreted zod, per its own benchmarks).
 *
 * `zod-compiler`'s `compile()` only emits AOT code once a build step has run
 * over the schema — its Vite/webpack/esbuild/SWC plugin, or `zod-compiler
 * generate` from the CLI. Neither runs for this package: it ships as plain
 * TypeScript source with no bundler of its own, consumed by whatever build
 * (or lack of one) the application uses. Called with no such step wired in,
 * `compile()` returns the original schema object, identity-preserved and
 * augmented with an allocation-light `.is()` guard, and its `parse`/
 * `safeParse` delegate straight through to zod (`zod-compiler`'s own
 * documented dev-time behaviour). That is still genuinely the real backend,
 * not a stand-in for it: the schema handed to `compile()` here is the exact
 * object a downstream build step would compile, so the day one is wired in,
 * every call through this seam speeds up without a change on either side.
 *
 * A handful of schema shapes stay interpreted-only even with a build step,
 * because `zod-compiler` has documented that it cannot compile them:
 * `superRefine`/arbitrary check callbacks, `transform` (sync or async),
 * `z.custom()`, `z.instanceof()`, algorithmic string formats (cuid, ulid,
 * base64, jwt, ...), and a schema-level error map that is a function rather
 * than a static string. For those, `compileSchema` below skips `compile()`
 * entirely — there is nothing for a build step to do differently later — and
 * validates through interpreted zod directly, recording *why* on the
 * fallback metric so the gap stays visible on a dashboard instead of costing
 * throughput silently. That reason is distinct from the metric firing
 * because `compile()` itself could not be used at all (see
 * `FALLBACK_REASON_COMPILER_UNAVAILABLE` below) — one says "this schema will
 * never compile", the other says "the compiled backend did not take this
 * call". The `is`/`parse`/`safeParse` contract does not change either way.
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

/**
 * The reason a schema took the fallback branch instead of `zod-compiler`'s
 * `compile()`.
 *
 * `compiler-unavailable` covers `compile()` itself failing to produce a
 * usable compiled schema — a defensive branch, not one any schema in this
 * package's test suite is expected to hit, but "degrade, never fail" means
 * a future incompatible `zod-compiler` release or an exotic schema object
 * still validates rather than throwing out of `compileSchema`.
 *
 * The rest name a specific construct `zod-compiler` has documented it cannot
 * compile — see the module docblock. These are the schema's own shape, not
 * a runtime failure, so `compile()` is never even called for them.
 */
const FALLBACK_REASON_COMPILER_UNAVAILABLE = "compiler-unavailable";
const FALLBACK_REASON_CUSTOM_VALIDATOR = "custom";
const FALLBACK_REASON_SUPER_REFINE = "superRefine";
const FALLBACK_REASON_TRANSFORM = "transform";
const FALLBACK_REASON_PREPROCESS = "preprocess";
const FALLBACK_REASON_ALGORITHMIC_STRING_FORMAT = "algorithmic-string-format";
const FALLBACK_REASON_DYNAMIC_ERROR_MAP = "dynamic-error-map";

/**
 * String check kinds zod computes algorithmically (base64 decode, JWT
 * segment parsing, ...) rather than by regular expression. `zod-compiler`
 * documents plain pattern-based checks (`email`, `url`, `uuid`, `regex`,
 * `includes`, `startsWith`, `endsWith`, ...) as compiled; this list is the
 * complement it does not, so it is deliberately short and specific rather
 * than an "everything not in the supported list" guess.
 */
const ALGORITHMIC_STRING_CHECK_KINDS = new Set([
  "cuid",
  "cuid2",
  "ulid",
  "nanoid",
  "base64",
  "base64url",
  "jwt",
  "emoji",
]);

/**
 * A minimal, internal `_def` shape covering exactly the fields the
 * classifier below reads across zod's built-in types. Zod does not export a
 * discriminated-union type for this — each concrete schema class types its
 * own `_def` — so this is deliberately narrow rather than a guess at zod's
 * full internal typing.
 */
interface IntrospectableDef {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  effect?: { type?: string };
  schema?: z.ZodTypeAny;
  checks?: readonly { kind?: string }[];
  shape?: () => Record<string, z.ZodTypeAny>;
  type?: z.ZodTypeAny;
  errorMap?: unknown;
}

function defOf(schema: z.ZodTypeAny): IntrospectableDef {
  // Reaching into `_def` is the same trade the module docblock already makes
  // for the WeakMap cache: zod does not type this per-subclass shape
  // publicly, but it is stable, documented-by-convention internal structure
  // that `zod-compiler`'s own build-time extractor reads the same way.
  return (schema as unknown as { _def: IntrospectableDef })._def;
}

const UNWRAPPABLE_TYPE_NAMES = new Set([
  "ZodOptional",
  "ZodNullable",
  "ZodDefault",
  "ZodBranded",
  "ZodReadonly",
  "ZodCatch",
]);

/**
 * Finds the first documented `zod-compiler` fallback reason inside `schema`,
 * or `undefined` if none is present.
 *
 * Walks through simple modifiers (`optional`, `nullable`, `default`, ...) and
 * one level into `object` properties and `array` elements — enough to catch
 * the shapes this package's aggregates and events actually use (an object of
 * simple fields, some of them optional) without reimplementing
 * `zod-compiler`'s own full schema walk, which is exactly the duplication
 * this module exists to avoid.
 */
function findUnsupportedReason(schema: z.ZodTypeAny, depth = 0): string | undefined {
  if (depth > 8) return undefined;

  const def = defOf(schema);

  if (def.typeName !== undefined && UNWRAPPABLE_TYPE_NAMES.has(def.typeName) && def.innerType) {
    return findUnsupportedReason(def.innerType, depth + 1);
  }

  switch (def.typeName) {
    case "ZodEffects": {
      const effectType = def.effect?.type;
      if (effectType === "preprocess") return FALLBACK_REASON_PREPROCESS;
      if (effectType === "transform") return FALLBACK_REASON_TRANSFORM;
      // "refinement" covers both refine/superRefine and z.custom()/
      // z.instanceof() — both are implemented as `z.any().superRefine(...)`,
      // distinguishable only by the wrapped type being the unconstrained
      // ZodAny rather than a real schema.
      const innerTypeName = def.schema && defOf(def.schema).typeName;
      return innerTypeName === "ZodAny"
        ? FALLBACK_REASON_CUSTOM_VALIDATOR
        : FALLBACK_REASON_SUPER_REFINE;
    }
    case "ZodString": {
      const algorithmic = def.checks?.find(
        (check) => check.kind !== undefined && ALGORITHMIC_STRING_CHECK_KINDS.has(check.kind),
      );
      return algorithmic ? FALLBACK_REASON_ALGORITHMIC_STRING_FORMAT : undefined;
    }
    case "ZodObject": {
      if (def.errorMap) return FALLBACK_REASON_DYNAMIC_ERROR_MAP;
      const shape = def.shape?.() ?? {};
      for (const key of Object.keys(shape)) {
        const reason = findUnsupportedReason(shape[key] as z.ZodTypeAny, depth + 1);
        if (reason) return reason;
      }
      return undefined;
    }
    case "ZodArray":
      return def.type ? findUnsupportedReason(def.type, depth + 1) : undefined;
    default:
      return def.errorMap ? FALLBACK_REASON_DYNAMIC_ERROR_MAP : undefined;
  }
}

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

function recordFallback(metrics: Metrics, reason: string): void {
  metrics
    .counter({
      name: "es_schema_compile_fallback_total",
      help: "Schemas compiled via the interpreted zod fallback instead of a compiled backend, by reason.",
      labelNames: ["reason"],
    })
    .inc({ reason });
}

function interpretedSchema<T>(schema: z.ZodType<T>): CompiledSchema<T> {
  return {
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
}

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
  // Defensive: the classifier reaches into zod's internal `_def` shape, so an
  // unrecognised or malformed schema object should fall through to the real
  // `compile()` attempt below rather than take down `compileSchema` itself.
  let unsupportedReason: string | undefined;
  try {
    unsupportedReason = findUnsupportedReason(schema);
  } catch {
    unsupportedReason = undefined;
  }

  let compiled: CompiledSchema<T>;
  if (unsupportedReason !== undefined) {
    recordFallback(metrics, unsupportedReason);
    compiled = interpretedSchema(schema);
  } else {
    try {
      const backend = compile(schema);
      if (!isCompiledSchema(backend)) {
        throw new Error("zod-compiler did not tag the compiled schema");
      }
      compiled = {
        is: (value): value is T => backend.is(value),
        parse: (value): T => backend.parse(value),
        safeParse(value) {
          const result = backend.safeParse(value);
          return result.success
            ? { ok: true, value: result.data }
            : { ok: false, error: result.error };
        },
      };
    } catch {
      recordFallback(metrics, FALLBACK_REASON_COMPILER_UNAVAILABLE);
      compiled = interpretedSchema(schema);
    }
  }

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
