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
 * Free text an agent writes ABOUT the session (an error, a sub-agent's task,
 * a commit message). It routinely quotes prompt and reply together, so it
 * survives only for a viewer allowed BOTH, like evaluator `details`.
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
 * The gate's fallback for an event in neither table: it withholds EVERY key,
 * not just `body`, since a new adapter could otherwise leak `prompt` or
 * `response_text` straight through untouched. Unknown side, so BOTH gate.
 */
const UNKNOWN_EVENT_CONTENT_KEYS: readonly LogContentKey[] = ALL_CONTENT_KEYS.map((key) => ({
  key,
  category: SESSION_FREE_TEXT,
}));

/** The table entry for an event, or undefined when neither table places it. */
function pickContentKeys(eventName: string): readonly LogContentKey[] | undefined {
  const canonical = normalizeEventName(eventName);
  if (canonical !== null && CONTENT_KEYS_BY_EVENT[canonical]) {
    return CONTENT_KEYS_BY_EVENT[canonical];
  }
  return CONTENT_KEYS_BY_RAW_EVENT[eventName];
}

/**
 * What the API's log redaction withholds: every content key present on the
 * record, each behind its own category, or (for an unrecognised event) every
 * key the table knows — always a superset of `contentAttrKeys`.
 */
export function logContentKeys(eventName: string): readonly LogContentKey[] {
  return pickContentKeys(eventName) ?? UNKNOWN_EVENT_CONTENT_KEYS;
}

/**
 * What read-path enrichment probes for an event's content payload: the FIRST
 * key present. An unrecognised event keeps the plain `body` fallback rather
 * than the gate's wide one — hiding too much is safe, showing the wrong thing isn't.
 */
export function contentAttrKeys(eventName: string): readonly string[] {
  return pickContentKeys(eventName)?.map((entry) => entry.key) ?? [BODY_ATTR];
}
