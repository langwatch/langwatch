/**
 * Codex rollout transcript -> per-turn input/output.
 *
 * Codex's native OTLP spans (scope `codex_cli_rs`) carry tokens, model, and
 * timing but never the prompt or the assistant reply. Codex DOES persist the
 * whole conversation to disk as a JSONL "rollout" at
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl`, and crucially
 * each turn's `task_started` event records the exact OTLP `trace_id` codex used
 * for that turn's spans. That lets the wrapper recover the content AFTER the
 * session and emit it on codex's own trace_id, so it joins the token-spans on
 * the same trace with no receiver-side join.
 *
 * Rollout line shapes this parser relies on (codex 0.137):
 * - `{"type":"event_msg","payload":{"type":"task_started","turn_id":"...","trace_id":"<hex32>"}}`
 * - `{"type":"turn_context","payload":{"turn_id":"...","model":"gpt-5.5"}}`
 * - `{"type":"response_item","payload":{"type":"message","role":"user|assistant|developer","content":[{"type":"input_text|output_text","text":"..."}]}}`
 * - `{"type":"event_msg","payload":{"type":"agent_message","message":"...","phase":"final_answer"}}`
 */

/** A reasonable cap so a runaway transcript can't post a multi-MB span. */
const MAX_IO_CHARS = 60_000;

export interface CodexTurnIO {
  /** Hex OTLP trace_id codex used for this turn's spans (the join key). */
  traceId: string;
  turnId: string | null;
  model: string | null;
  /** The user's prompt(s) for the turn, excluding codex's injected context. */
  input: string;
  /** The assistant's final reply for the turn. */
  output: string;
  /** Turn start in unix ms, for a sane span start time (best-effort). */
  startedAtMs: number | null;
}

interface WorkingTurn {
  traceId: string;
  turnId: string | null;
  model: string | null;
  inputs: string[];
  output: string | null;
  startedAtMs: number | null;
}

function truncate(text: string): string {
  return text.length > MAX_IO_CHARS ? text.slice(0, MAX_IO_CHARS) : text;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const t = (part as { text?: unknown; output_text?: unknown }).text;
      const ot = (part as { output_text?: unknown }).output_text;
      if (typeof t === "string") parts.push(t);
      else if (typeof ot === "string") parts.push(ot);
    }
  }
  return parts.join("").trim();
}

/**
 * Parse a codex rollout JSONL into one input/output record per turn. Turns
 * with no assistant reply are dropped (an empty span helps no one). Order is
 * preserved by trace_id first-seen.
 */
export function parseCodexRollout(content: string): CodexTurnIO[] {
  const byTrace = new Map<string, WorkingTurn>();
  const order: string[] = [];
  let currentTraceId: string | null = null;
  let currentModel: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: { type?: string; payload?: Record<string, unknown> };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const payload = obj.payload ?? {};

    if (obj.type === "turn_context") {
      const m = payload.model;
      if (typeof m === "string" && m) currentModel = m;
      continue;
    }

    if (obj.type === "event_msg" && payload.type === "task_started") {
      const traceId =
        typeof payload.trace_id === "string" ? payload.trace_id : null;
      if (!traceId) continue;
      currentTraceId = traceId;
      if (!byTrace.has(traceId)) {
        order.push(traceId);
        byTrace.set(traceId, {
          traceId,
          turnId: typeof payload.turn_id === "string" ? payload.turn_id : null,
          model: currentModel,
          inputs: [],
          output: null,
          startedAtMs:
            typeof payload.started_at === "number"
              ? payload.started_at * 1000
              : null,
        });
      }
      continue;
    }

    if (!currentTraceId) continue;
    const turn = byTrace.get(currentTraceId);
    if (!turn) continue;
    if (currentModel && !turn.model) turn.model = currentModel;

    // The assistant's clean final answer rides the agent_message event; prefer
    // it over the raw response_item which can repeat tool scaffolding.
    if (obj.type === "event_msg" && payload.type === "agent_message") {
      const msg = payload.message;
      if (typeof msg === "string" && msg.trim()) turn.output = msg.trim();
      continue;
    }

    if (obj.type === "response_item" && payload.type === "message") {
      const role = payload.role;
      const text = textFromContent(payload.content);
      if (!text) continue;
      if (role === "user") {
        // Codex injects an "<environment_context>" user turn (cwd, shell,
        // date) ahead of the real prompt; it's scaffolding, not the user's
        // input, so it must never become the trace input.
        if (text.startsWith("<environment_context>")) continue;
        turn.inputs.push(text);
      } else if (role === "assistant" && turn.output === null) {
        // Fallback only — agent_message wins when both are present.
        turn.output = text;
      }
    }
  }

  const result: CodexTurnIO[] = [];
  for (const traceId of order) {
    const t = byTrace.get(traceId)!;
    const input = t.inputs.join("\n").trim();
    const output = (t.output ?? "").trim();
    // Drop turns with no assistant reply: an input-only span just duplicates
    // what the OTLP-logs path could already do and adds an empty output.
    if (!output) continue;
    result.push({
      traceId,
      turnId: t.turnId,
      model: t.model,
      input: truncate(input),
      output: truncate(output),
      startedAtMs: t.startedAtMs,
    });
  }
  return result;
}
