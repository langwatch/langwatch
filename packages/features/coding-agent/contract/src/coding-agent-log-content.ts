import { normalizeEventName } from "./telemetry/coding-agent-normalization";

/**
 * Which log attribute carries captured content, and which content category it
 * belongs to, for every coding agent.
 *
 * This is the one mapping behind BOTH sides of the log-record contract: the
 * read-path enrichment surfaces these keys as span content, and the API's log
 * redaction withholds them from a viewer the data-privacy policy hides that
 * category from. A key surfaced by one and missed by the other is a policy
 * bypass, so they read from the same table.
 *
 * ## Keyed on the CANONICAL event, not the wire name
 *
 * Only Claude Code emits bare event names (`user_prompt`, `tool_result`).
 * codex and gemini namespace theirs (`codex.tool_result`,
 * `gemini_cli.api_response`), and `normalizeEventName` is what the transcript
 * derivation resolves them with. Matching the wire spelling instead means a
 * namespaced record matches nothing, carries no known content key, and leaves
 * the gate untouched with its payload intact.
 *
 * ## Per KEY, not per record
 *
 * A codex `tool_result` carries the call's arguments AND its output on one
 * record: `arguments` is what the agent was asked to run (input), `output` is
 * what came back (output). Classifying the record as a whole can only be
 * correct in one direction, so each key carries its own category and is gated
 * on its own.
 */

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

/**
 * Wire names with no canonical alias, so `normalizeEventName` cannot place
 * them. `api_request_body` is claude's raw request payload: the request side
 * of a model call, gated on input like the `api_request` it belongs to.
 *
 * Looked up on the RAW name, deliberately: these spellings exist precisely
 * because the canonical vocabulary has no entry for them. A namespaced
 * variant (`claude_code.api_request_body`) therefore misses this table and
 * falls to {@link UNKNOWN_EVENT_CONTENT_KEYS}, which over-hides rather than
 * under-hides. Keep it that way: an entry here with an `output` or `input`
 * category is only reachable by exact wire spelling, so anything that needs
 * to survive a namespace belongs in the canonical table above.
 */
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
const UNKNOWN_EVENT_CONTENT_KEYS: readonly LogContentKey[] = ALL_CONTENT_KEYS.map(
  (key) => ({ key, category: SESSION_FREE_TEXT }),
);

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
