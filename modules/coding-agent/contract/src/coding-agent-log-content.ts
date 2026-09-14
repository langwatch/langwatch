import { normalizeEventName } from "./telemetry/coding-agent-normalization.ts";

// Mapping of log attributes to content categories, shared between read-path
// enrichment and API redaction to prevent policy bypass; keyed on canonical
// event names (normalized) and per-key because different fields have different
// privacy categories.

/** The category a content key is gated behind. */
export type LogContentCategory = "input" | "output" | "both";

/** One content-bearing attribute and the visibility it follows. */
export interface LogContentKey {
  key: string;
  category: LogContentCategory;
}

/**
 * The trailing fallback: an emitter with no per-event key convention puts the
 * record's content in `body`. Its category comes from the event.
 */
const BODY_ATTR = "body";

/**
 * Free text an agent writes ABOUT the session (an error it hit, the task it
 * handed a sub-agent, the commit message it wrote). It routinely quotes the
 * prompt and the reply together, so it survives only for a viewer allowed
 * BOTH, mirroring how evaluator `details` are gated in `trace-view-gates.api.ts`.
 */
const SESSION_FREE_TEXT: LogContentCategory = "both";

/**
 * Content keys per canonical event, in the order a reader probes them (`body`
 * always trailing). Events absent here fall back to
 * {@link UNKNOWN_EVENT_CONTENT_KEYS}.
 */
const CONTENT_KEYS_BY_EVENT: Readonly<Record<string, readonly LogContentKey[]>> = {
  // The user's own words. claude/codex/gemini all spell it `prompt`.
  user_prompt: [
    { key: "prompt", category: "input" },
    { key: BODY_ATTR, category: "input" },
  ],
  // The assistant's reply, as claude's dedicated event.
  assistant_response: [
    { key: "response", category: "output" },
    { key: BODY_ATTR, category: "output" },
  ],
  // The request side of a model call: claude's `api_request_body` carries the
  // raw Messages JSON, the bare `api_request` is its cost anchor and normally
  // carries no body at all.
  api_request: [{ key: BODY_ATTR, category: "input" }],
  // The response side. gemini puts the reply on `response_text`; claude's
  // `api_response_body` aliases here and carries the raw payload on `body`.
  api_response: [
    { key: "response_text", category: "output" },
    { key: BODY_ATTR, category: "output" },
  ],
  // A tool run: what it was asked to do, and what it answered. claude spells
  // the arguments `tool_input` / `tool_parameters`, codex `arguments`,
  // gemini `function_args`; codex is the one that also carries the result.
  tool_result: [
    { key: "tool_input", category: "input" },
    { key: "tool_parameters", category: "input" },
    { key: "arguments", category: "input" },
    { key: "function_args", category: "input" },
    { key: "output", category: "output" },
    { key: BODY_ATTR, category: SESSION_FREE_TEXT },
  ],
  // A tool the human was asked to approve: the arguments are the whole point.
  tool_decision: [
    { key: "tool_parameters", category: "input" },
    { key: "function_args", category: "input" },
    { key: BODY_ATTR, category: SESSION_FREE_TEXT },
  ],
  session_error: [
    { key: "error", category: SESSION_FREE_TEXT },
    { key: BODY_ATTR, category: SESSION_FREE_TEXT },
  ],
  internal_error: [
    { key: "error", category: SESSION_FREE_TEXT },
    { key: BODY_ATTR, category: SESSION_FREE_TEXT },
  ],
  subtask_invoked: [
    { key: "description", category: SESSION_FREE_TEXT },
    { key: BODY_ATTR, category: SESSION_FREE_TEXT },
  ],
  commit: [
    { key: "message", category: SESSION_FREE_TEXT },
    { key: BODY_ATTR, category: SESSION_FREE_TEXT },
  ],
};

// Raw wire names not in canonical table; looked up by exact spelling to
// prevent namespace variants from bypassing the redaction policy.
const CONTENT_KEYS_BY_RAW_EVENT: Readonly<Record<string, readonly LogContentKey[]>> = {
  api_request_body: [{ key: BODY_ATTR, category: "input" }],
};

/** Every content key any known event uses, `body` trailing. */
const ALL_CONTENT_KEYS: readonly string[] = [
  ...new Set(
    Object.values(CONTENT_KEYS_BY_EVENT)
      .flatMap((entries) => entries.map((entry) => entry.key))
      .filter((key) => key !== BODY_ATTR),
  ),
  BODY_ATTR,
];

/**
 * The gate's fallback for an event in neither table. It withholds EVERY key
 * the table knows, not just `body`: a new agent adapter, or a new event on an
 * existing one, would otherwise carry `prompt` or `response_text` straight
 * through the gate untouched — the same bypass shape a namespaced event had.
 * The side is unknown, so every one of them needs BOTH categories.
 */
const UNKNOWN_EVENT_CONTENT_KEYS: readonly LogContentKey[] = ALL_CONTENT_KEYS.map((key) => ({
  key,
  category: SESSION_FREE_TEXT,
}));

/** The table entry for an event, or undefined when neither table places it. */
function knownContentKeys(eventName: string): readonly LogContentKey[] | undefined {
  const canonical = normalizeEventName(eventName);
  if (canonical !== null && CONTENT_KEYS_BY_EVENT[canonical]) {
    return CONTENT_KEYS_BY_EVENT[canonical];
  }
  return CONTENT_KEYS_BY_RAW_EVENT[eventName];
}

/**
 * What the API's log redaction withholds: every content key present on the
 * record, each behind its own category, and for an unrecognised event every
 * key the table knows. Always a superset of {@link contentAttrKeys}, which is
 * what makes the gate impossible to walk past.
 */
export function logContentKeys(eventName: string): readonly LogContentKey[] {
  return knownContentKeys(eventName) ?? UNKNOWN_EVENT_CONTENT_KEYS;
}

/**
 * What the read-path enrichment probes to find an event's content payload, in
 * order: it reads the FIRST key present. An unrecognised event keeps the plain
 * `body` convention here rather than the gate's wide fallback, because guessing
 * a content key for an event we do not know would surface the wrong attribute
 * as span content. Hiding too much is safe; showing the wrong thing is not.
 */
export function contentAttrKeys(eventName: string): readonly string[] {
  return knownContentKeys(eventName)?.map((entry) => entry.key) ?? [BODY_ATTR];
}
