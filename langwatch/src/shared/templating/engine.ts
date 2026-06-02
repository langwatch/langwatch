import { Liquid } from "liquidjs";

/**
 * Per-template wall-clock budget. A render that exceeds it is abandoned and
 * the caller falls back to the framework default. This is a best-effort guard
 * against runaway templates — it bounds wall-clock time but cannot interrupt a
 * synchronous CPU-bound loop mid-iteration (see ADR-024).
 */
export const RENDER_TIMEOUT_MS = 500;

let engine: Liquid | undefined;

/**
 * Shared, cached Liquid engine for customer-authored notification templates.
 *
 * - `strictFilters` rejects unknown filters (caught upstream, falls back to default).
 * - `strictVariables: false` renders missing variables as empty rather than throwing,
 *   so a customer typo degrades gracefully instead of breaking dispatch.
 * - `cache` keeps compiled templates in an LRU so repeated digests don't re-parse.
 */
export function getLiquidEngine(): Liquid {
  if (!engine) {
    engine = new Liquid({
      strictFilters: true,
      strictVariables: false,
      cache: true,
    });
  }
  return engine;
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

function detectMissingVariables({
  template,
  context,
}: {
  template: string;
  context: Record<string, unknown>;
}): string[] {
  try {
    // `globalVariables` excludes locals (for-loop vars, {% assign %}, {% capture %}),
    // so only genuinely external references that the context omits are reported.
    const referenced = getLiquidEngine().globalVariablesSync(template);
    return referenced.filter((name) => !(name in context));
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
    const output = await Promise.race([
      getLiquidEngine().parseAndRender(template, context),
      deadline,
    ]);
    return { output, missingVariables };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
