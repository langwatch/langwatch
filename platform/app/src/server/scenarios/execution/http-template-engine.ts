/**
 * Shared Liquid template engine for HTTP agent adapters.
 *
 * Three engines with identical filter sets but different output handling:
 *   - `urlLiquid`: URL-encodes interpolated values by default. `| raw` opts out.
 *   - `bodyLiquid`: JSON-string-escapes scalar interpolations by default so a
 *     raw newline / quote / backslash in a conversation turn can't break the
 *     body's JSON. Pre-serialized JSON (the `messages` array) is injected raw,
 *     and `| raw` opts an individual expression out of escaping.
 *   - `headerLiquid`: plain-text output. A header value is neither a url nor
 *     JSON, so nothing is encoded or escaped on interpolation.
 *
 * Both adapters (DB-backed and serialized) use these engines so HTTP agents
 * render URL, body and header templates through one render pipeline.
 */

import type { AgentInput } from "@langwatch/scenario";
import { Liquid } from "liquidjs";
import type { FieldMapping } from "../field-mapping";
import type { RunParameterValues } from "../parameters";
import { resolveFieldMappings, sourceFieldOf } from "./resolve-field-mappings";

/**
 * Marks a context value as already-serialized JSON that must be interpolated
 * into a body template verbatim (the conversation `messages` array, or
 * structured `input` content). `bodyLiquid`'s `outputEscape` returns these
 * unescaped; every other value is treated as a scalar string and
 * JSON-string-escaped.
 */
export class RawJson {
  constructor(private readonly json: string) {}
  toString(): string {
    return this.json;
  }
}

/**
 * Escape a scalar for safe interpolation inside a JSON string literal
 * (`"{{ value }}"`) without adding the surrounding quotes the template already
 * supplies. `JSON.stringify` handles control characters, quotes, backslashes
 * and lone surrogates per the JSON spec; we strip only its outer quotes.
 */
function escapeForJsonStringLiteral(value: unknown): string {
  return JSON.stringify(String(value ?? "")).slice(1, -1);
}

const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

export type TemplateField = "url" | "bodyTemplate" | "headers";

/**
 * Error thrown when a Liquid template fails to parse or render.
 * Identifies the failing field so callers can surface precise diagnostics.
 * `detail` narrows the field further when the field alone is ambiguous,
 * such as which of several headers failed.
 */
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

/**
 * URL template engine. `outputEscape` URL-encodes every `{{ expr }}` output
 * unless the final filter in the expression is `raw` (registered with
 * `raw: true`, which liquidjs honors by skipping outputEscape).
 */
const urlLiquid = new Liquid({
  outputEscape: (value) => encodeURIComponent(String(value ?? "")),
});
urlLiquid.registerFilter("raw", { handler: identity, raw: true });

/**
 * Body template engine. `outputEscape` JSON-string-escapes every `{{ expr }}`
 * output so a control character / quote / backslash in a conversation turn
 * can't break the body's JSON (the n8n "Failed to parse request body" class of
 * bug). Values wrapped in `RawJson` (the pre-serialized `messages` array) pass
 * through verbatim, and `| raw` opts an individual expression out — both
 * mirror how `urlLiquid` skips encoding for `raw`-tagged filters.
 */
const bodyLiquid = new Liquid({
  outputEscape: (value) =>
    value instanceof RawJson ? value.toString() : escapeForJsonStringLiteral(value),
});
bodyLiquid.registerFilter("raw", { handler: identity, raw: true });

/**
 * Header template engine. Output is plain text: a header value is neither a
 * url nor JSON, so no `outputEscape` at all. `raw` is registered anyway so an
 * expression written for the other engines keeps working unchanged.
 */
const headerLiquid = new Liquid();
headerLiquid.registerFilter("raw", { handler: identity, raw: true });

/**
 * Build the Liquid context shared by `url` and `bodyTemplate` rendering.
 *
 * Base context (always present, derived from AgentInput):
 *   - `messages` — JSON-encoded messages array, wrapped in `RawJson` so body
 *     templates inject it as a raw JSON array, not an escaped string
 *   - `threadId` — thread ID or default sentinel (scalar string)
 *   - `input` — last user message content. A string when the turn is text;
 *     structured content is JSON-stringified and wrapped in `RawJson` so
 *     `{"input": {{input}}}` keeps injecting it as a raw object/array.
 *   - `traceId` / `traceparent`: the turn's trace context, when the caller
 *     captured one. Plain scalar strings bound beside `threadId`: a data
 *     mapping with the same identifier still wins, and `params` (a single
 *     namespace key) can never shadow them.
 *
 * The run's resolved parameters are bound as `params`, so a url or body reads
 * `{{ params.account_tier }}`. It sits between the base names and the mappings
 * on purpose: it can never take `input`, `messages` or `threadId` away from a
 * template, and a data mapping a customer already named `params` still wins.
 *
 * Scalar values stay plain strings; `bodyLiquid` JSON-string-escapes them on
 * interpolation. `scenarioMappings` output is merged last and overrides base
 * keys, preserving each mapping's raw-vs-scalar treatment.
 */
export function buildTemplateContext({
  input,
  scenarioMappings,
  parameters,
  traceContext,
}: {
  input: AgentInput;
  scenarioMappings?: Record<string, FieldMapping>;
  parameters?: RunParameterValues;
  traceContext?: { traceId?: string; traceparent?: string };
}): Record<string, unknown> {
  const lastUserMessage = input.messages.findLast((m) => m.role === "user");
  const inputIsStructured =
    lastUserMessage !== undefined && typeof lastUserMessage.content !== "string";
  const base: Record<string, unknown> = {
    messages: new RawJson(JSON.stringify(input.messages)),
    threadId: input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
    input:
      lastUserMessage === undefined
        ? undefined
        : inputIsStructured
          ? new RawJson(JSON.stringify(lastUserMessage.content))
          : (lastUserMessage.content as string),
  };
  if (traceContext?.traceId !== undefined) {
    base.traceId = traceContext.traceId;
  }
  if (traceContext?.traceparent !== undefined) {
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
      if (value === undefined) continue;
      const field = sourceFieldOf(mapping);
      const isRawJson = field === "messages" || (field === "input" && inputIsStructured);
      mapped[identifier] = isRawJson ? new RawJson(value) : value;
    }
  }

  return { ...base, params: parameters ?? {}, ...mapped };
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

/**
 * Render one header value. `headerKey` names the header in the error a failed
 * render throws, because "headers" alone cannot say which of several values
 * was the malformed one.
 */
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
  // The renderer rejects header injection itself instead of relying on the
  // fetch layer: a conversation turn can carry line breaks, and a rendered
  // CR, LF or NUL in a header value would otherwise only fail deep in the
  // HTTP client with a message that names no header.
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

/**
 * Merge the automatically captured W3C propagation headers (`traceparent`,
 * `tracestate`, `baggage`) into the request's rendered headers.
 *
 * The propagation headers go last but never clobber: header names are
 * case-insensitive on the wire, so a propagation header is only added when no
 * rendered header already carries that name in any casing. A target that
 * templates its own `traceparent` has chosen its trace context deliberately
 * and keeps it.
 */
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
