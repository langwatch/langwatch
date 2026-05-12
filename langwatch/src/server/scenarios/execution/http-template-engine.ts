/**
 * Shared Liquid template engine for HTTP agent adapters.
 *
 * Two engines with identical filter sets but different output handling:
 *   - `urlLiquid`: URL-encodes interpolated values by default. `| raw` opts out.
 *   - `bodyLiquid`: renders values verbatim — body templates are JSON, not URLs.
 *
 * Both adapters (DB-backed and serialized) use these engines so HTTP agents
 * render URL and body templates through one render pipeline.
 */

import type { AgentInput } from "@langwatch/scenario";
import { Liquid } from "liquidjs";
import { resolveFieldMappings } from "./resolve-field-mappings";
import type { FieldMapping } from "./types";

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

export type TemplateField = "url" | "bodyTemplate";

/**
 * Error thrown when a Liquid template fails to parse or render.
 * Identifies the failing field so callers can surface precise diagnostics.
 */
export class TemplateRenderError extends Error {
  readonly field: TemplateField;
  readonly cause: unknown;

  constructor({
    field,
    cause,
  }: {
    field: TemplateField;
    cause: unknown;
  }) {
    const rootMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to render ${field} template: ${rootMessage}`);
    this.name = "TemplateRenderError";
    this.field = field;
    this.cause = cause;
  }
}

const identity = <T>(v: T): T => v;

/**
 * URL template engine. `outputEscape` URL-encodes every `{{ expr }}` output
 * unless the final filter in the expression is `raw` (registered with
 * `raw: true`, which liquidjs honors by skipping outputEscape).
 */
const urlLiquid = new Liquid({
  outputEscape: (value) => encodeURIComponent(String(value ?? "")),
});
urlLiquid.registerFilter("raw", { handler: identity, raw: true });

/** Body template engine. No default encoding — bodies are JSON. */
const bodyLiquid = new Liquid();
bodyLiquid.registerFilter("raw", { handler: identity, raw: true });

/**
 * Build the Liquid context shared by `url` and `bodyTemplate` rendering.
 *
 * Base context (always present, derived from AgentInput):
 *   - `messages` — JSON-encoded messages array
 *   - `threadId` — thread ID or default sentinel
 *   - `input` — last user message content (string, JSON-stringified if structured)
 *
 * `scenarioMappings` output is merged last and overrides base keys so users
 * can redefine `input` to be a structured object without breaking existing
 * templates.
 */
export function buildTemplateContext({
  input,
  scenarioMappings,
}: {
  input: AgentInput;
  scenarioMappings?: Record<string, FieldMapping>;
}): Record<string, unknown> {
  const lastUserMessage = input.messages.findLast((m) => m.role === "user");
  const base: Record<string, unknown> = {
    messages: JSON.stringify(input.messages),
    threadId: input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
    input:
      lastUserMessage === undefined
        ? undefined
        : typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content),
  };

  const mapped = scenarioMappings
    ? resolveFieldMappings({ fieldMappings: scenarioMappings, agentInput: input })
    : {};

  return { ...base, ...mapped };
}

export function renderUrlTemplate({
  template,
  context,
}: {
  template: string;
  context: Record<string, unknown>;
}): string {
  try {
    return urlLiquid.parseAndRenderSync(template, context);
  } catch (cause) {
    throw new TemplateRenderError({ field: "url", cause });
  }
}

export function renderBodyTemplate({
  template,
  context,
}: {
  template: string;
  context: Record<string, unknown>;
}): string {
  try {
    return bodyLiquid.parseAndRenderSync(template, context);
  } catch (cause) {
    throw new TemplateRenderError({ field: "bodyTemplate", cause });
  }
}
