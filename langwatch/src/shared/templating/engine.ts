import { Liquid, type Template } from "liquidjs";

/**
 * Per-template wall-clock budget. A render that exceeds it is abandoned and
 * the caller falls back to the framework default. This is a best-effort guard
 * against runaway templates — it bounds wall-clock time but cannot interrupt a
 * synchronous CPU-bound loop mid-iteration (see ADR-028).
 */
export const RENDER_TIMEOUT_MS = 500;

/**
 * Object-creation budget for a single render (LiquidJS `memoryLimit`, counted in
 * units of new objects/array-concats/strftime allocations, not bytes). Bounds a
 * template that tries to balloon memory (e.g. nested loops building huge arrays)
 * regardless of the wall-clock budget. 1e6 is generous for any legitimate
 * notification template while still tripping on hostile growth.
 */
export const RENDER_MEMORY_LIMIT = 1_000_000;

type PathSegment = string | number;

let engine: Liquid | undefined;

/**
 * Shared Liquid engine for customer-authored notification templates.
 *
 * - `strictFilters` rejects unknown filters (caught upstream, falls back to default).
 * - `strictVariables: false` renders missing variables as empty rather than throwing,
 *   so a customer typo degrades gracefully instead of breaking dispatch.
 * - LiquidJS's built-in `cache` option only populates on `renderFile` / file-path
 *   keys, so it does NOT help here — `parseAndRender(string, ...)` re-parses on
 *   every call. We layer a process-local string-keyed cache in `renderLiquid`
 *   (`PARSED_TEMPLATE_CACHE` below) so repeated digest renders of the same
 *   template source reuse the parsed AST.
 */
export function getLiquidEngine(): Liquid {
  if (!engine) {
    engine = new Liquid({
      strictFilters: true,
      strictVariables: false,
      // Hide prototype chains from customer-authored templates so accesses like
      // `{{ name.constructor }}` resolve to empty rather than leaking internals.
      // Set explicitly rather than relying on LiquidJS's default, which could
      // change on a minor bump.
      ownPropertyOnly: true,
      // DoS guards: `renderLimit` bounds wall-clock time *inside* a synchronous
      // render (interrupting a CPU-bound loop the Promise.race backstop can't),
      // and `memoryLimit` caps object creation. Both are interruption-capable in
      // liquidjs >=10.6, so a hostile template no longer pins the worker.
      renderLimit: RENDER_TIMEOUT_MS,
      memoryLimit: RENDER_MEMORY_LIMIT,
    });
  }
  return engine;
}

/**
 * Process-local cache of parsed templates keyed by source string. `parseAndRender`
 * doesn't go through LiquidJS's internal file-path cache, so without this layer
 * every digest re-parses the same source — wasted CPU under any load. Capacity
 * is bounded so a misbehaving caller can't grow it without limit.
 */
const PARSED_TEMPLATE_CACHE_LIMIT = 256;
const PARSED_TEMPLATE_CACHE = new Map<string, Template[]>();

function getParsedTemplate(source: string): Template[] {
  const cached = PARSED_TEMPLATE_CACHE.get(source);
  if (cached) {
    // Refresh LRU position — delete + set moves the entry to the end.
    PARSED_TEMPLATE_CACHE.delete(source);
    PARSED_TEMPLATE_CACHE.set(source, cached);
    return cached;
  }
  const parsed = getLiquidEngine().parse(source);
  if (PARSED_TEMPLATE_CACHE.size >= PARSED_TEMPLATE_CACHE_LIMIT) {
    const oldest = PARSED_TEMPLATE_CACHE.keys().next().value;
    if (oldest !== undefined) PARSED_TEMPLATE_CACHE.delete(oldest);
  }
  PARSED_TEMPLATE_CACHE.set(source, parsed);
  return parsed;
}

/**
 * Process-local cache of the referenced-variable segment paths for a template
 * source. `globalVariableSegmentsSync` re-parses the source on every call, so
 * without this layer the missing-variable diagnostic pays a full parse on every
 * render even when the AST is already in `PARSED_TEMPLATE_CACHE`. Keyed by the
 * same source string and bounded the same way.
 */
const REFERENCED_SEGMENTS_CACHE = new Map<string, PathSegment[][]>();

function getReferencedSegments(source: string): PathSegment[][] {
  const cached = REFERENCED_SEGMENTS_CACHE.get(source);
  if (cached) {
    REFERENCED_SEGMENTS_CACHE.delete(source);
    REFERENCED_SEGMENTS_CACHE.set(source, cached);
    return cached;
  }
  // `globalVariableSegmentsSync` returns each referenced variable as an array of
  // property segments (e.g. `project.nmae` → `["project", "nmae"]`), excluding
  // locals (for-loop vars, `{% assign %}`, `{% capture %}`). It types segments as
  // `(string | number | SegmentArray)[]` to cover bracketed/grouped expressions;
  // for the variable surfaces we expose, only flat string/number segments make
  // sense, so anything exotic gets dropped here rather than later per render.
  const referenced = getLiquidEngine().globalVariableSegmentsSync(source);
  const normalized: PathSegment[][] = [];
  for (const raw of referenced) {
    const segments: PathSegment[] = [];
    let exotic = false;
    for (const segment of raw) {
      if (typeof segment === "string" || typeof segment === "number") {
        segments.push(segment);
      } else {
        exotic = true;
        break;
      }
    }
    if (exotic || segments.length === 0) continue;
    normalized.push(segments);
  }
  if (REFERENCED_SEGMENTS_CACHE.size >= PARSED_TEMPLATE_CACHE_LIMIT) {
    const oldest = REFERENCED_SEGMENTS_CACHE.keys().next().value;
    if (oldest !== undefined) REFERENCED_SEGMENTS_CACHE.delete(oldest);
  }
  REFERENCED_SEGMENTS_CACHE.set(source, normalized);
  return normalized;
}

export interface LiquidRenderResult {
  output: string;
  /**
   * External variable names the template referenced but the context did not
   * provide. Surfaced to operators so authors learn about typos without the
   * dispatch failing. Loop/assign locals are excluded (scope-aware analysis).
   */
  missingVariables: string[];
}

export class RenderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Liquid render exceeded ${timeoutMs}ms budget`);
    this.name = "RenderTimeoutError";
  }
}

function hasNestedPath(context: Record<string, unknown>, segments: PathSegment[]): boolean {
  let current: unknown = context;
  for (const segment of segments) {
    if (current == null) return false;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return false;
      if (segment < 0 || segment >= current.length) return false;
      current = current[segment];
      continue;
    }
    if (typeof current !== "object") return false;
    if (!(segment in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function detectMissingVariables({
  template,
  context,
}: {
  template: string;
  context: Record<string, unknown>;
}): string[] {
  try {
    // The referenced segment paths are cached per source string (see
    // `getReferencedSegments`), so the full re-parse only happens on a cache
    // miss. Using full segment paths catches property-level typos that the
    // top-level-only form misses — e.g. `{{ project.nmae }}` correctly reports
    // `project.nmae` instead of silently accepting it because `project` exists.
    const referenced = getReferencedSegments(template);
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const segments of referenced) {
      const path = segments.join(".");
      if (seen.has(path)) continue;
      seen.add(path);
      if (!hasNestedPath(context, segments)) missing.push(path);
    }
    return missing;
  } catch {
    // Analysis is diagnostic-only; never let it break the render path.
    return [];
  }
}

/**
 * Renders a Liquid template against a context, bounded by a wall-clock timeout.
 * Throws on syntax errors, unknown filters, or timeout — callers catch and fall
 * back to the framework default.
 */
export async function renderLiquid({
  template,
  context,
  timeoutMs = RENDER_TIMEOUT_MS,
}: {
  template: string;
  context: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<LiquidRenderResult> {
  const missingVariables = detectMissingVariables({ template, context });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    // Use the process-local parsed-template cache so repeated digest renders
    // of the same source string skip the parse pass entirely. `parseAndRender`
    // would otherwise re-parse on every call.
    const parsed = getParsedTemplate(template);
    // Pass the caller's budget as the per-render `renderLimit` so the
    // interruption-capable engine guard matches `timeoutMs` (the engine-level
    // default only covers callers that don't override the budget). The
    // Promise.race deadline remains the async backstop.
    const output = await Promise.race([
      getLiquidEngine().render(parsed, context, {
        renderLimit: timeoutMs,
        memoryLimit: RENDER_MEMORY_LIMIT,
      }),
      deadline,
    ]);
    return { output, missingVariables };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
