/**
 * Codex rollout transcript -> per-turn chat-message request body + reply.
 *
 * Codex's native OTLP spans (scope `codex_cli_rs`) carry tokens, model, and
 * timing but never the prompt, the system instructions, the tool calls, or the
 * assistant reply. Codex DOES persist the whole conversation to disk as a JSONL
 * "rollout" at `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl`,
 * and crucially each turn's `task_started` event records the exact OTLP
 * `trace_id` codex used for that turn's spans. That lets the wrapper recover the
 * FULL request body codex sent to the model AFTER the session and emit it on
 * codex's own trace_id, so it joins the token-spans on the same trace with no
 * receiver-side join.
 *
 * The rollout is the running conversation state (the OpenAI Responses API
 * `input` array), append-only. We replay it into an accumulating chat history
 * and, at each turn boundary, snapshot that history as the turn's `input` (the
 * request actually sent to the model: system prompt + every prior message + the
 * current user prompt + any mid-turn tool calls/results) with the turn's final
 * assistant answer as `output`. This mirrors how the claude log-to-span fold
 * turns a `/v1/messages` body into `gen_ai.input.messages`, so a codex trace
 * renders the same full conversation a claude trace does.
 *
 * Rollout line shapes this parser relies on (codex 0.137; `git` since 0.14x):
 * - `{"type":"session_meta","payload":{"id":"<threadId>","base_instructions":"...","cwd":"...","git":{"branch":"...","repository_url":"..."}}}`
 * - `{"type":"turn_context","payload":{"model":"gpt-5.5"}}`
 * - `{"type":"event_msg","payload":{"type":"task_started","turn_id":"...","trace_id":"<hex32>"}}`
 * - `{"type":"event_msg","payload":{"type":"user_message","message":"..."}}` (the typed prompt)
 * - `{"type":"response_item","payload":{"type":"message","role":"developer|user|assistant","content":[{"type":"input_text|output_text","text":"..."}]}}`
 * - `{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{...}","call_id":"..."}}`
 * - `{"type":"response_item","payload":{"type":"function_call_output","call_id":"...","output":"..."}}`
 * - `{"type":"event_msg","payload":{"type":"agent_message","message":"...","phase":"final_answer"}}`
 */

/** Per-message content cap so a single huge tool output can't dominate the span. */
const MAX_CONTENT_CHARS = 30_000;
/** Whole-input cap (well under the 256KB ingestion attribute ceiling). */
const MAX_INPUT_CHARS = 120_000;
/** Final-answer cap. */
const MAX_OUTPUT_CHARS = 30_000;

/**
 * A LangWatch chat message. Roles map to the canonical chat roles
 * (`system|user|assistant|tool`); codex's `developer` role is folded into
 * `system`. Shapes a subset of the platform `chatMessageSchema` so the
 * receiver's LangWatch extractor canonicalises it to `gen_ai.input.messages`.
 */
export interface CodexChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface CodexTurnIO {
  /** Hex OTLP trace_id codex used for this turn's spans (the join key). */
  traceId: string;
  turnId: string | null;
  model: string | null;
  /**
   * The full request body as sent to the model for this turn: the system
   * prompt, every prior message, the current user prompt, and any mid-turn
   * tool calls/results — everything except the turn's final assistant answer.
   */
  inputMessages: CodexChatMessage[];
  /** The assistant's final reply for the turn (plain text). */
  output: string;
  /** Turn start in unix ms, for a sane span start time (best-effort). */
  startedAtMs: number | null;
}

/**
 * Session-level identity from the rollout's `session_meta` line: which session
 * this transcript belongs to and which repository, branch and directory it ran
 * in. Codex records these once at session start (`id`, `cwd`, `git.branch`,
 * `git.repository_url`) and exports none of them over telemetry, so this line
 * is the only repository identity a plain codex run reports anywhere.
 */
export interface CodexRolloutMeta {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  gitRepositoryUrl: string | null;
  /**
   * The first thing the user typed, apart from the context codex injects as
   * user-role messages. What names the session, since codex generates no title
   * of its own. Read from the `user_message` event, and from the conversation
   * itself when there is none. Codex 0.149 emits no such event in any mode,
   * interactive or exec, so the conversation is the only source there.
   */
  firstUserMessage: string | null;
}

/** Everything one rollout parse yields: the turns, plus the session identity. */
export interface ParsedCodexRollout {
  turns: CodexTurnIO[];
  meta: CodexRolloutMeta | null;
}

/**
 * A block codex wrote to itself rather than one a person typed. Codex opens
 * each injected block with a tag naming it, and the typed prompt never opens
 * with one.
 */
const INJECTED_CONTEXT_BLOCK = /^<[A-Za-z_][\w-]*>/;

/**
 * Whether a user-role message is context codex injected.
 *
 * Codex bundles a whole injection into ONE message carrying several content
 * parts, and only some of them open with a tag. A real session on the agents
 * box opens part one with the markdown heading `# AGENTS.md instructions` and
 * part two with `<environment_context>`. Flattening the parts first would put
 * that heading at the front, hide the tag behind it, and let the heading name
 * the session, so each part is tested on its own and any tagged part condemns
 * the message.
 *
 * Which part carries the tag is not a signal: the parts of a bundle share a
 * turn id and land hundredths of a second apart, so there is no order to lean
 * on and nothing is reordered here.
 */
function isInjectedContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const t = (part as { text?: unknown }).text;
    const ot = (part as { output_text?: unknown }).output_text;
    const text = typeof t === "string" ? t : typeof ot === "string" ? ot : "";
    return INJECTED_CONTEXT_BLOCK.test(text.trim());
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const t = (part as { text?: unknown }).text;
      const ot = (part as { output_text?: unknown }).output_text;
      if (typeof t === "string") parts.push(t);
      else if (typeof ot === "string") parts.push(ot);
    }
  }
  return parts.join("").trim();
}

function outputToText(output: unknown): string {
  if (typeof output === "string") return output;
  // `custom_tool_call_output` hands the result back as content blocks rather
  // than a string. Serialising those verbatim would put a JSON array where the
  // reader expects the command's output.
  if (Array.isArray(output)) {
    const text = textFromContent(output);
    if (text) return text;
  }
  if (output && typeof output === "object") {
    // codex wraps exec output as { output: "...", metadata: {...} } sometimes
    const inner = (output as { output?: unknown }).output;
    if (typeof inner === "string") return inner;
    try {
      return JSON.stringify(output);
    } catch {
      return "";
    }
  }
  if (typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }
  return "";
}

/**
 * One message's capped form and the number of bytes it costs in the serialized
 * array, remembered against the message it came from.
 *
 * Every turn caps the conversation SO FAR, so the same early messages are
 * measured again on every later turn, and a session that runs for weeks
 * measures its first message thousands of times. The messages never change
 * once the accumulator pushes them, so each one is capped and measured once
 * and the answer is kept here. A WeakMap, so a parsed rollout costs nothing
 * once its messages are unreachable.
 */
const cappedMessages = new WeakMap<
  CodexChatMessage,
  { message: CodexChatMessage; bytes: number }
>();

function capOneMessage(message: CodexChatMessage): {
  message: CodexChatMessage;
  bytes: number;
} {
  const remembered = cappedMessages.get(message);
  if (remembered) return remembered;
  const capped =
    typeof message.content === "string" && message.content.length > MAX_CONTENT_CHARS
      ? { ...message, content: truncate(message.content, MAX_CONTENT_CHARS) }
      : message;
  const entry = { message: capped, bytes: JSON.stringify(capped).length };
  cappedMessages.set(message, entry);
  return entry;
}

/**
 * Bound the serialized input: cap each message's content, then drop the oldest
 * NON-system messages until the whole array is under the total cap. System
 * messages (the prompt the user actually asked to see) are always preserved.
 *
 * The total is tracked as the messages are dropped rather than measured again
 * after each one. Measuring again read the whole conversation per dropped
 * message, which on a long session took minutes per turn: codex runs the
 * harvest after every completed turn, so the next harvest started before the
 * last one finished and the conversation never reached the server.
 */
function capInputMessages(messages: CodexChatMessage[]): CodexChatMessage[] {
  const entries = messages.map(capOneMessage);
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  let kept = entries.length;
  // What `JSON.stringify` of the kept messages would answer: the brackets,
  // every message, and one comma between each neighbouring pair.
  const serializedLength = () => 2 + bytes + Math.max(kept - 1, 0);
  const dropped = new Set<number>();
  for (let i = 0; i < entries.length && serializedLength() > MAX_INPUT_CHARS; i++) {
    const entry = entries[i];
    if (!entry || entry.message.role === "system") continue;
    dropped.add(i);
    bytes -= entry.bytes;
    kept -= 1;
  }
  return entries.filter((_, index) => !dropped.has(index)).map((entry) => entry.message);
}

/** One parsed rollout JSONL line: a tagged envelope with an opaque payload. */
interface RolloutLine {
  type?: string;
  payload?: Record<string, unknown>;
}

/** The value when it is a non-empty string, else null. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** The tool call's explicit id (`call_id`, then `id`), or null if codex omitted both. */
function explicitToolCallId(payload: Record<string, unknown>): string | null {
  if (typeof payload.call_id === "string" && payload.call_id) {
    return payload.call_id;
  }
  if (typeof payload.id === "string" && payload.id) return payload.id;
  return null;
}

/**
 * Replays a codex rollout's events into a running chat history and snapshots one
 * {@link CodexTurnIO} per turn boundary. All the cross-event state (the running
 * history, the open turn, the held assistant text, the authoritative final
 * answer, the session model) lives here so {@link parseCodexRollout} stays a
 * thin parse-and-dispatch coordinator.
 */
class CodexTurnAccumulator {
  /** Emitted turns, in rollout order. */
  private readonly turns: CodexTurnIO[] = [];
  /** Session identity from the `session_meta` line, when one was present. */
  private meta: CodexRolloutMeta | null = null;
  /** Accumulating conversation across the whole rollout (claude-style). */
  private readonly history: CodexChatMessage[] = [];
  private sessionModel: string | null = null;
  private cur: {
    traceId: string;
    turnId: string | null;
    model: string | null;
    startedAtMs: number | null;
  } | null = null;
  /** Latest assistant text not yet committed to history (the final-answer candidate). */
  private pendingAssistant: string | null = null;
  /** The first typed prompt of the thread. */
  private firstUserMessage: string | null = null;
  /** Authoritative final answer from the agent_message(final_answer) event. */
  private agentFinal: string | null = null;
  /**
   * Synthetic ids minted for tool calls that arrived without a `call_id`, queued
   * FIFO so the matching (also id-less) function_call_output pairs to the same id
   * instead of drifting as the running history grows.
   */
  private readonly pendingToolCallIds: string[] = [];
  private autoToolCallSeq = 0;

  /** Route one parsed rollout line to the handler for its event type. */
  handle(obj: RolloutLine): void {
    const payload = obj.payload ?? {};
    switch (obj.type) {
      case "session_meta":
        return this.onSessionMeta(payload);
      case "turn_context":
        return this.onTurnContext(payload);
      case "event_msg":
        return this.onEventMsg(payload);
      case "response_item":
        return this.onResponseItem(payload);
    }
  }

  /** Close the trailing open turn and return everything the rollout yielded. */
  finish(): ParsedCodexRollout {
    this.closeTurn();
    // The first prompt arrives after session_meta, so it joins here.
    const meta =
      this.meta === null ? null : { ...this.meta, firstUserMessage: this.firstUserMessage };
    return { turns: this.turns, meta };
  }

  private onSessionMeta(payload: Record<string, unknown>): void {
    const bi = payload.base_instructions;
    if (typeof bi === "string" && bi.trim()) {
      this.history.push({ role: "system", content: bi.trim() });
    }
    const git =
      payload.git && typeof payload.git === "object"
        ? (payload.git as Record<string, unknown>)
        : {};
    this.meta = {
      sessionId: nonEmptyString(payload.id) ?? nonEmptyString(payload.session_id),
      cwd: nonEmptyString(payload.cwd),
      gitBranch: nonEmptyString(git.branch),
      gitRepositoryUrl: nonEmptyString(git.repository_url),
      firstUserMessage: null,
    };
  }

  private onTurnContext(payload: Record<string, unknown>): void {
    const m = payload.model;
    if (typeof m === "string" && m) {
      this.sessionModel = m;
      if (this.cur) this.cur.model = m;
    }
  }

  private onEventMsg(payload: Record<string, unknown>): void {
    if (payload.type === "task_started") return this.onTaskStarted(payload);
    if (payload.type === "task_complete") return this.closeTurn();
    // The typed prompt precedes its turn (submission comes before
    // task_started), so it is read regardless of an open turn.
    if (payload.type === "user_message") return this.onUserMessage(payload);
    // Everything below belongs to the open turn; ignore it outside one.
    if (!this.cur) return;
    if (payload.type === "agent_message") this.onAgentMessage(payload);
  }

  private onUserMessage(payload: Record<string, unknown>): void {
    const msg = payload.message;
    if (typeof msg === "string") this.rememberTypedPrompt(msg);
  }

  /**
   * The first thing the person typed, from whichever place records it.
   *
   * Both places reach this. The `user_message` event carries it in a TUI
   * session; the conversation carries it in a `codex exec` session, which
   * emits no such event at all and so reached the sessions screen unnamed.
   * The event still wins whenever there is one, because it is read before a
   * turn opens while a conversation message is only read inside one, and a
   * turn opens at `task_started`, after the submission that emits the event.
   *
   * Codex also speaks to itself in both places, injecting its context as
   * user-role text wrapped in a tag of its own (`<environment_context>`,
   * `<recommended_plugins>`, ...). Only what the person typed arrives
   * untagged, and a 10k-character plugin catalogue makes a poor session
   * title. The test below covers the event, which only ever carries a plain
   * string; a conversation message is screened by `isInjectedContent` at the
   * call site instead, because it can carry several content parts and the tag
   * may sit in any of them. Screening both is what keeps an injected block
   * from claiming the name and locking out the real prompt beside it.
   */
  private rememberTypedPrompt(text: string): void {
    if (this.firstUserMessage !== null) return;
    const trimmed = text.trim();
    if (!trimmed || INJECTED_CONTEXT_BLOCK.test(trimmed)) return;
    this.firstUserMessage = trimmed;
  }

  private onTaskStarted(payload: Record<string, unknown>): void {
    this.closeTurn();
    const traceId = typeof payload.trace_id === "string" ? payload.trace_id : null;
    if (!traceId) return;
    this.cur = {
      traceId,
      turnId: typeof payload.turn_id === "string" ? payload.turn_id : null,
      model: this.sessionModel,
      startedAtMs: typeof payload.started_at === "number" ? payload.started_at * 1000 : null,
    };
  }

  private onAgentMessage(payload: Record<string, unknown>): void {
    // The clean final answer rides the agent_message(final_answer) event; prefer
    // it over the raw assistant response_item which can repeat tool scaffolding.
    const msg = payload.message;
    if (typeof msg === "string" && msg.trim() && payload.phase === "final_answer") {
      this.agentFinal = msg.trim();
    }
  }

  private onResponseItem(payload: Record<string, unknown>): void {
    // response_items belong to the open turn; ignore them outside one.
    if (!this.cur) return;
    switch (payload.type) {
      case "message":
        return this.onMessage(payload);
      // Codex spells a tool call several ways depending on how the model was
      // asked to call it, and which spelling shows up changes between releases
      // (0.146 uses `custom_tool_call` for the shell where 0.137 used
      // `function_call`). Handling only one of them silently drops every tool
      // call from the recovered conversation, so all of them route here.
      case "function_call":
      case "custom_tool_call":
      case "local_shell_call":
        return this.onFunctionCall(payload);
      case "function_call_output":
      case "custom_tool_call_output":
        return this.onFunctionCallOutput(payload);
    }
  }

  private onMessage(payload: Record<string, unknown>): void {
    const role = payload.role;
    const text = textFromContent(payload.content);
    if (!text) return;
    if (role === "developer") {
      this.flushPendingAssistant();
      this.history.push({ role: "system", content: text });
    } else if (role === "user") {
      this.flushPendingAssistant();
      this.history.push({ role: "user", content: text });
      // Tested on the parts rather than the flattened text, because a
      // bundle can open with an untagged heading and carry its tag in a
      // later part.
      if (!isInjectedContent(payload.content)) this.rememberTypedPrompt(text);
    } else if (role === "assistant") {
      // Hold: this may be a mid-turn preamble (committed to history when the
      // next item arrives) or the turn's final answer (consumed by closeTurn).
      this.flushPendingAssistant();
      this.pendingAssistant = text;
    }
  }

  private onFunctionCall(payload: Record<string, unknown>): void {
    this.flushPendingAssistant();
    let callId = explicitToolCallId(payload);
    if (!callId) {
      // codex omitted the id: mint a stable one and queue it for the output.
      callId = `call_auto_${this.autoToolCallSeq++}`;
      this.pendingToolCallIds.push(callId);
    }
    const name = typeof payload.name === "string" ? payload.name : "tool";
    // `function_call` names the argument blob `arguments`; `custom_tool_call`
    // and `local_shell_call` name it `input` / `action`.
    const rawArgs = payload.arguments ?? payload.input ?? payload.action;
    const args =
      typeof rawArgs === "string" ? rawArgs : rawArgs != null ? JSON.stringify(rawArgs) : "";
    this.history.push({
      role: "assistant",
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name, arguments: truncate(args, MAX_CONTENT_CHARS) },
        },
      ],
    });
  }

  private onFunctionCallOutput(payload: Record<string, unknown>): void {
    this.flushPendingAssistant();
    // Reuse the id codex gave; else pair FIFO with the matching id-less call.
    const callId =
      explicitToolCallId(payload) ??
      this.pendingToolCallIds.shift() ??
      `call_auto_${this.autoToolCallSeq++}`;
    this.history.push({
      role: "tool",
      tool_call_id: callId,
      content: truncate(outputToText(payload.output), MAX_CONTENT_CHARS),
    });
  }

  private flushPendingAssistant(): void {
    if (this.pendingAssistant !== null) {
      this.history.push({ role: "assistant", content: this.pendingAssistant });
      this.pendingAssistant = null;
    }
  }

  private closeTurn(): void {
    if (this.cur) {
      const finalAnswer = this.agentFinal ?? this.pendingAssistant;
      if (finalAnswer?.trim()) {
        this.turns.push({
          traceId: this.cur.traceId,
          turnId: this.cur.turnId,
          model: this.cur.model ?? this.sessionModel,
          inputMessages: capInputMessages([...this.history]),
          output: truncate(finalAnswer.trim(), MAX_OUTPUT_CHARS),
          startedAtMs: this.cur.startedAtMs,
        });
        this.history.push({ role: "assistant", content: finalAnswer.trim() });
      }
    }
    // Synthetic fallback ids only pair a call with its output *within* a turn.
    // A call left unmatched at the boundary (output never arrived) must not
    // leak its queued id into the next turn, or that turn's first id-less
    // output would pair to the wrong call. `autoToolCallSeq` stays monotonic
    // so the ids themselves remain unique across the session.
    this.pendingToolCallIds.length = 0;
    this.cur = null;
    this.pendingAssistant = null;
    this.agentFinal = null;
  }
}

/**
 * Parse a codex rollout JSONL into one chat-message request/reply record per
 * turn, plus the session identity its `session_meta` line carries. Turns with
 * no assistant reply are dropped (an empty span helps no one).
 */
export function parseCodexRollout(content: string): ParsedCodexRollout {
  const acc = new CodexTurnAccumulator();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: RolloutLine;
    try {
      obj = JSON.parse(trimmed) as RolloutLine;
    } catch {
      continue;
    }
    acc.handle(obj);
  }
  return acc.finish();
}
