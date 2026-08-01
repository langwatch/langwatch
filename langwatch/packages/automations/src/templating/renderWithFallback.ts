import { renderLiquid } from "./engine";

export interface FallbackRender {
  output: string;
  /** True when the framework default was used (custom was null or threw). */
  usedDefault: boolean;
  missingVariables: string[];
  /** Set when a custom template threw and we fell back. */
  error?: string;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Renders `template` if provided, falling back to `fallback` (the framework
 * default) when the custom template is null or throws. A throw from the
 * fallback itself propagates — that is a framework bug, not customer input.
 */
export async function renderWithFallback({
  template,
  fallback,
  context,
}: {
  template: string | null;
  fallback: string;
  context: Record<string, unknown>;
}): Promise<FallbackRender> {
  if (template == null) {
    const rendered = await renderLiquid({ template: fallback, context });
    return {
      output: rendered.output,
      usedDefault: true,
      missingVariables: rendered.missingVariables,
    };
  }
  try {
    const rendered = await renderLiquid({ template, context });
    return {
      output: rendered.output,
      usedDefault: false,
      missingVariables: rendered.missingVariables,
    };
  } catch (err) {
    const rendered = await renderLiquid({ template: fallback, context });
    return {
      output: rendered.output,
      usedDefault: true,
      missingVariables: rendered.missingVariables,
      error: errorMessage(err),
    };
  }
}
