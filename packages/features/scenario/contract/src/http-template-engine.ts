/** Shared Liquid rendering for both persisted and serialised HTTP agents. */

import { Liquid } from "liquidjs";
import type { FieldMapping } from "./field-mapping";
import { resolveFieldMappings, sourceFieldOf } from "./resolve-field-mappings";
import type { ScenarioInput } from "./resolve-field-mappings";
import type { RunParameterValues } from "./scenario.parameters";

/** Marks pre-serialised JSON that body templates must interpolate verbatim. */
export class RawJson {
  constructor(private readonly json: string) {}
  toString(): string {
    return this.json;
  }
}

/** Escapes a scalar without adding the quotes already present in a template. */
function escapeForJsonStringLiteral(value: unknown): string {
  return JSON.stringify(String(value ?? "")).slice(1, -1);
}

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

export type TemplateField = "url" | "bodyTemplate" | "headers";

/** A template failure tied to the field the caller can report. */
export class TemplateRenderError extends Error {
  readonly field: TemplateField;
  readonly detail: string | undefined;
  readonly cause: unknown;

  constructor({
    field,
    cause,
    detail,
  }: {
    field: TemplateField;
    cause: unknown;
    detail?: string;
  }) {
    const rootMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to render ${field} template${detail ? ` (${detail})` : ""}: ${rootMessage}`,
    );
    this.name = "TemplateRenderError";
    this.field = field;
    this.detail = detail;
    this.cause = cause;
  }
}

const identity = <T>(v: T): T => v;

const urlLiquid = new Liquid({
  outputEscape: (value) => encodeURIComponent(String(value ?? "")),
});
urlLiquid.registerFilter("raw", { handler: identity, raw: true });

const bodyLiquid = new Liquid({
  outputEscape: (value) =>
    value instanceof RawJson ? value.toString() : escapeForJsonStringLiteral(value),
});
bodyLiquid.registerFilter("raw", { handler: identity, raw: true });

const headerLiquid = new Liquid();
headerLiquid.registerFilter("raw", { handler: identity, raw: true });

/**
 * Builds the shared template context. Explicit mappings are merged last to
 * preserve the existing override behaviour.
 */
export function buildTemplateContext({
  input,
  scenarioMappings,
  parameters,
  traceContext,
}: {
  input: ScenarioInput;
  scenarioMappings?: Record<string, FieldMapping>;
  parameters?: RunParameterValues;
  traceContext?: { traceId?: string; traceparent?: string };
}): Record<string, unknown> {
  const lastUserMessage = findLastUserMessage(input);
  const inputIsStructured =
    lastUserMessage !== void 0 && typeof lastUserMessage.content !== "string";

  let inputValue: unknown = void 0;
  if (lastUserMessage !== void 0) {
    if (typeof lastUserMessage.content === "string") {
      inputValue = lastUserMessage.content;
    } else {
      inputValue = new RawJson(JSON.stringify(lastUserMessage.content));
    }
  }

  const base: Record<string, unknown> = {
    messages: new RawJson(JSON.stringify(input.messages)),
    threadId: input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
    input: inputValue,
  };

  if (traceContext?.traceId !== void 0) {
    base.traceId = traceContext.traceId;
  }
  if (traceContext?.traceparent !== void 0) {
    base.traceparent = traceContext.traceparent;
  }

  const mapped: Record<string, unknown> = {};
  if (scenarioMappings) {
    const resolved = resolveFieldMappings({
      fieldMappings: scenarioMappings,
      agentInput: input,
    });
    for (const [identifier, mapping] of Object.entries(scenarioMappings)) {
      const value = resolved[identifier];
      if (value === void 0) {
        continue;
      }

      const field = sourceFieldOf(mapping);
      const isRawJson = field === "messages" || (field === "input" && inputIsStructured);
      mapped[identifier] = isRawJson ? new RawJson(value) : value;
    }
  }

  return { ...base, params: parameters ?? {}, ...mapped };
}

function findLastUserMessage(
  input: ScenarioInput,
): { role: string; content: unknown } | undefined {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role === "user") {
      return message;
    }
  }

  return void 0;
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

export function renderHeaderTemplate({
  template,
  context,
  headerKey,
}: {
  template: string;
  context: Record<string, unknown>;
  headerKey: string;
}): string {
  let rendered: string;
  try {
    rendered = headerLiquid.parseAndRenderSync(template, context);
  } catch (cause) {
    throw new TemplateRenderError({
      field: "headers",
      cause,
      detail: `header "${headerKey}"`,
    });
  }

  // Reject injection here so the error names the affected header.
  if (/[\r\n\0]/.test(rendered)) {
    throw new TemplateRenderError({
      field: "headers",
      cause: new Error(
        "the rendered value contains a line break or NUL character, which is not valid in an HTTP header",
      ),
      detail: `header "${headerKey}"`,
    });
  }

  return rendered;
}

/** Adds propagation headers without replacing case-insensitive user headers. */
export function mergePropagationHeaders({
  headers,
  propagationHeaders,
}: {
  headers: Record<string, string>;
  propagationHeaders: Record<string, string>;
}): Record<string, string> {
  const present = new Set(Object.keys(headers).map((key) => key.toLowerCase()));
  const merged = { ...headers };
  for (const [key, value] of Object.entries(propagationHeaders)) {
    if (!present.has(key.toLowerCase())) {
      merged[key] = value;
    }
  }
  return merged;
}
