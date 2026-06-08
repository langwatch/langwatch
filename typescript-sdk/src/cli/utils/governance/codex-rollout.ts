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
 * Rollout line shapes this parser relies on (codex 0.137):
 * - `{"type":"session_meta","payload":{"base_instructions":"...","cwd":"..."}}`
 * - `{"type":"turn_context","payload":{"model":"gpt-5.5"}}`
 * - `{"type":"event_msg","payload":{"type":"task_started","turn_id":"...","trace_id":"<hex32>"}}`
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
 * Bound the serialized input: cap each message's content, then drop the oldest
 * NON-system messages until the whole array is under the total cap. System
 * messages (the prompt the user actually asked to see) are always preserved.
 */
function capInputMessages(messages: CodexChatMessage[]): CodexChatMessage[] {
  const capped = messages.map((m) =>
    typeof m.content === "string" && m.content.length > MAX_CONTENT_CHARS
      ? { ...m, content: truncate(m.content, MAX_CONTENT_CHARS) }
      : m,
  );
  const serializedLength = () => JSON.stringify(capped).length;
  let i = 0;
  while (serializedLength() > MAX_INPUT_CHARS && i < capped.length) {
    if (capped[i]?.role === "system") {
      i++;
      continue;
    }
    capped.splice(i, 1);
  }
  return capped;
}

/** One parsed rollout JSONL line: a tagged envelope with an opaque payload. */
interface RolloutLine {
  type?: string;
  payload?: Record<string, unknown>;
}

/** Resolve a tool call's id, preferring `call_id`, then `id`, then a fallback. */
function toolCallId(payload: Record<string, unknown>, fallback: string): string {
  return (
    (typeof payload.call_id === "string" && payload.call_id) ||
    (typeof payload.id === "string" && payload.id) ||
    fallback
  );
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
  /** Authoritative final answer from the agent_message(final_answer) event. */
  private agentFinal: string | null = null;

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

  /** Close the trailing open turn and return every emitted turn. */
  finish(): CodexTurnIO[] {
    this.closeTurn();
    return this.turns;
  }

  private onSessionMeta(payload: Record<string, unknown>): void {
    const bi = payload.base_instructions;
    if (typeof bi === "string" && bi.trim()) {
      this.history.push({ role: "system", content: bi.trim() });
    }
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
    // Everything below belongs to the open turn; ignore it outside one.
    if (!this.cur) return;
    if (payload.type === "agent_message") this.onAgentMessage(payload);
  }

  private onTaskStarted(payload: Record<string, unknown>): void {
    this.closeTurn();
    const traceId =
      typeof payload.trace_id === "string" ? payload.trace_id : null;
    if (!traceId) return;
    this.cur = {
      traceId,
      turnId: typeof payload.turn_id === "string" ? payload.turn_id : null,
      model: this.sessionModel,
      startedAtMs:
        typeof payload.started_at === "number"
          ? payload.started_at * 1000
          : null,
    };
  }

  private onAgentMessage(payload: Record<string, unknown>): void {
    // The clean final answer rides the agent_message(final_answer) event; prefer
    // it over the raw assistant response_item which can repeat tool scaffolding.
    const msg = payload.message;
    if (
      typeof msg === "string" &&
      msg.trim() &&
      payload.phase === "final_answer"
    ) {
      this.agentFinal = msg.trim();
    }
  }

  private onResponseItem(payload: Record<string, unknown>): void {
    // response_items belong to the open turn; ignore them outside one.
    if (!this.cur) return;
    switch (payload.type) {
      case "message":
        return this.onMessage(payload);
      case "function_call":
        return this.onFunctionCall(payload);
      case "function_call_output":
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
    } else if (role === "assistant") {
      // Hold: this may be a mid-turn preamble (committed to history when the
      // next item arrives) or the turn's final answer (consumed by closeTurn).
      this.flushPendingAssistant();
      this.pendingAssistant = text;
    }
  }

  private onFunctionCall(payload: Record<string, unknown>): void {
    this.flushPendingAssistant();
    const callId = toolCallId(payload, `call_${this.history.length}`);
    const name = typeof payload.name === "string" ? payload.name : "tool";
    const args =
      typeof payload.arguments === "string"
        ? payload.arguments
        : payload.arguments != null
          ? JSON.stringify(payload.arguments)
          : "";
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
    const callId = toolCallId(payload, `call_${this.history.length}`);
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
    this.cur = null;
    this.pendingAssistant = null;
    this.agentFinal = null;
  }
}

/**
 * Parse a codex rollout JSONL into one chat-message request/reply record per
 * turn. Turns with no assistant reply are dropped (an empty span helps no one).
 */
export function parseCodexRollout(content: string): CodexTurnIO[] {
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
