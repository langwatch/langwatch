/** Shared Liquid rendering for both persisted and serialised HTTP agents. */

import { Liquid } from "liquidjs";
import type { FieldMapping } from "./field-mapping";
import { resolveFieldMappings, sessionAsText, sourceFieldOf } from "./resolve-field-mappings";
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

  constructor({ field, cause, detail }: { field: TemplateField; cause: unknown; detail?: string }) {
    const rootMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to render ${field} template${detail ? ` (${detail})` : ""}: ${rootMessage}`);
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

/** An object or an array: a value a body template injects as raw JSON. */
function isStructured(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * The session as a template value: raw JSON when structured, text otherwise,
 * and an empty string before the thread's first answer.
 */
function sessionContextValue(session: unknown): RawJson | string {
  return isStructured(session) ? new RawJson(JSON.stringify(session)) : sessionAsText(session);
}

/**
 * The context keys a mapping filled from the held session.
 *
 * A mapping may alias the session to any identifier, so the name `session` is
 * not the only place the agent's own value reaches the template. The list
 * travels with the context rather than as an argument, so a caller cannot
 * build a context and forget to pass it. It is not enumerable, so the template
 * engine never renders it.
 */
const SESSION_DERIVED_KEYS = Symbol("sessionDerivedKeys");

/**
 * Builds the shared template context. Explicit mappings are merged last to
 * preserve the existing override behaviour.
 */
export function buildTemplateContext({
  input,
  scenarioMappings,
  parameters,
  traceContext,
  session,
}: {
  input: ScenarioInput;
  scenarioMappings?: Record<string, FieldMapping>;
  parameters?: RunParameterValues;
  traceContext?: { traceId?: string; traceparent?: string };
  /** The session held for the thread; absent or null renders as empty. */
  session?: unknown;
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

  const sessionIsStructured = isStructured(session);
  const base: Record<string, unknown> = {
    messages: new RawJson(JSON.stringify(input.messages)),
    threadId: input.threadId ?? DEFAULT_SCENARIO_THREAD_ID,
    input: inputValue,
    session: sessionContextValue(session),
  };

  if (traceContext?.traceId !== void 0) {
    base.traceId = traceContext.traceId;
  }
  if (traceContext?.traceparent !== void 0) {
    base.traceparent = traceContext.traceparent;
  }

  const mapped: Record<string, unknown> = {};
  const sessionDerived: string[] = [];
  if (scenarioMappings) {
    const resolved = resolveFieldMappings({
      fieldMappings: scenarioMappings,
      agentInput: input,
      session,
    });
    for (const [identifier, mapping] of Object.entries(scenarioMappings)) {
      const value = resolved[identifier];
      if (value === void 0) {
        continue;
      }

      const field = sourceFieldOf(mapping);
      const isRawJson =
        field === "messages" ||
        (field === "input" && inputIsStructured) ||
        (field === "session" && sessionIsStructured);
      mapped[identifier] = isRawJson ? new RawJson(value) : value;
      if (field === "session") sessionDerived.push(identifier);
    }
  }

  const context = { ...base, params: parameters ?? {}, ...mapped };
  Object.defineProperty(context, SESSION_DERIVED_KEYS, {
    value: sessionDerived,
    enumerable: false,
  });
  return context;
}

/** The origin of a rendered URL, or null when it names none. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Refuses a URL whose host the held session decided.
 *
 * The session is the agent's own answer handed back on the next turn, so it
 * is the one value in the context the agent fully controls. The request
 * carries the configured headers, the authentication among them, so a
 * session that moves the host would send those credentials wherever it
 * named. Every other variable still reaches `ssrfSafeFetch`, which is what
 * refuses a private or link-local address.
 */
function assertSessionDidNotChooseTheHost({
  template,
  context,
  rendered,
}: {
  template: string;
  context: Record<string, unknown>;
  rendered: string;
}): void {
  const derived = (context as Record<symbol, unknown>)[SESSION_DERIVED_KEYS];
  const aliases = Array.isArray(derived) ? (derived as string[]) : [];
  if (!("session" in context) && aliases.length === 0) return;
  const blanked: Record<string, unknown> = { ...context, session: "" };
  for (const alias of aliases) blanked[alias] = "";
  const withoutSession = urlLiquid.parseAndRenderSync(template, blanked);
  if (originOf(rendered) !== originOf(withoutSession)) {
    throw new Error("the session of the agent cannot decide the host the turn is sent to");
  }
}

function findLastUserMessage(input: ScenarioInput): { role: string; content: unknown } | undefined {
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
    const rendered = urlLiquid.parseAndRenderSync(template, context);
    assertSessionDidNotChooseTheHost({ template, context, rendered });
    return rendered;
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
