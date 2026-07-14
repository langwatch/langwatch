import { createHash } from "node:crypto";

/**
 * Some OTLP LOG emitters (Claude Code 2.1.x, Codex, and other agent
 * CLIs that ship logs without a traces exporter) send their records
 * with NO trace context — the standard exporter carries no active
 * span when the cost-bearing events fire. Without a trace_id+span_id
 * the receiver writes empty-id rows and the fold projection skips
 * them, so /me/traces shows nothing.
 *
 * `synthesizeTraceContext` derives STABLE ids from the record's own
 * correlation keys so the existing fold + I/O extractors do their job
 * unchanged, and MARKS each id it invents as LangWatch-added:
 *   - `syntheticTraceId` — true only when the trace_id was minted (the
 *     wire trace_id was absent). A real trace can legitimately contain a
 *     context-less record, so this flags the TRACE grouping, never a
 *     single record.
 *   - `syntheticSpanId` — true when the span_id was invented.
 * A present wire id is ALWAYS preserved: a record that carries a real
 * trace_id but no span_id keeps the real trace_id and only its span_id
 * is synthesized. When no correlation key is available we leave the
 * (empty) wire ids unchanged rather than minting a random per-record
 * id — that would create noise instead of grouping.
 */
const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

/**
 * Codex's instrumentation scope varies across builds (codex 0.131
 * uses `codex_exec`, 0.13x sometimes just `codex`), so the codex
 * derivation gates on the event.name prefix (`codex.*`) which is
 * stable across versions rather than on the scope name.
 */
const CODEX_EVENT_NAME_PREFIX = "codex.";

const TRACE_ID_HEX_LENGTH = 32;
const SPAN_ID_HEX_LENGTH = 16;

export interface SynthesizeTraceContextArgs {
  scopeName: string;
  wireTraceId: string;
  wireSpanId: string;
  attrs: Record<string, string>;
}

export interface SynthesizedTraceContext {
  traceId: string;
  spanId: string;
  /** True only when the trace_id was derived (wire trace_id was absent). */
  syntheticTraceId: boolean;
  /** True when the span_id was derived (wire span_id was absent). */
  syntheticSpanId: boolean;
  /** The correlation-key name the trace_id was derived from, or null when the
   * trace_id is a real wire id. */
  derivedFrom: string | null;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Combine wire ids with the derived ids for one branch: a present wire
 * id is always preserved (only the missing one is synthesized), and
 * `derivedFrom` is reported only when the trace_id itself was minted.
 */
function combine(args: {
  wireTraceId: string;
  wireSpanId: string;
  derivedTraceId: string;
  derivedSpanId: string;
  derivedFrom: string;
}): SynthesizedTraceContext {
  const {
    wireTraceId,
    wireSpanId,
    derivedTraceId,
    derivedSpanId,
    derivedFrom,
  } = args;
  const syntheticTraceId = !wireTraceId;
  const syntheticSpanId = !wireSpanId;
  return {
    traceId: wireTraceId || derivedTraceId,
    spanId: wireSpanId || derivedSpanId,
    syntheticTraceId,
    syntheticSpanId,
    derivedFrom: syntheticTraceId ? derivedFrom : null,
  };
}

function passthrough(
  wireTraceId: string,
  wireSpanId: string,
): SynthesizedTraceContext {
  return {
    traceId: wireTraceId,
    spanId: wireSpanId,
    syntheticTraceId: false,
    syntheticSpanId: false,
    derivedFrom: null,
  };
}

/**
 * Resolve trace + span ids for an OTLP log record, deriving stable
 * synthetic ids from the best available correlation key when the wire
 * context is absent. Pure and dependency-free.
 *
 * Order of resolution:
 *   1. Both wire ids present -> real OTLP context, passthrough.
 *   2. claude_code scope with `session.id` -> per-turn trace keyed on
 *      (session.id, prompt.id); per-event span keyed on
 *      (session.id, prompt.id, event.name, event.sequence). derivedFrom
 *      = "session.id".
 *   3. `event.name` starting `codex.` with `conversation.id` -> trace keyed
 *      on conversation.id; per-event span keyed on
 *      (conversation.id, event.name, event.sequence). derivedFrom =
 *      "conversation.id".
 *   4. Anything else -> passthrough of the (empty) wire ids, uncorrelated.
 *      Never mint a random per-record id, and never guess from generic
 *      keys: synthesis is only for the documented coding-agent shapes
 *      above, whose keys are verified session identities. A process-level
 *      key like `service.instance.id` would fuse every standalone log an
 *      application instance ever emits into one giant synthetic trace and
 *      route it all to one command shard - the exact hot-lane shape the
 *      ingest sharding exists to prevent. Agents whose emitters carry real
 *      trace context (gemini CLI, opencode span exporters) never reach
 *      synthesis at all.
 *
 * In branches 2-3 a present wire trace_id or span_id is preserved and
 * only the missing id is synthesized.
 */
export function synthesizeTraceContext(
  args: SynthesizeTraceContextArgs,
): SynthesizedTraceContext {
  const { scopeName, wireTraceId, wireSpanId, attrs } = args;

  // Real, complete OTLP context — never override, never mark.
  if (wireTraceId && wireSpanId) {
    return passthrough(wireTraceId, wireSpanId);
  }

  const eventName = attrs["event.name"] ?? "";
  const eventSequence = attrs["event.sequence"] ?? "";

  // claude_code: one trace PER TURN (session.id + prompt.id), one span
  // per event. Session-setup events before the first prompt (no
  // prompt.id) fall back to the session-level id.
  const sessionId = attrs["session.id"];
  if (scopeName === CLAUDE_CODE_EVENT_SCOPE && sessionId) {
    const promptId = attrs["prompt.id"] ?? "";
    const turnKey = promptId ? `${sessionId}:${promptId}` : sessionId;
    return combine({
      wireTraceId,
      wireSpanId,
      derivedTraceId: sha256Hex(turnKey).slice(0, TRACE_ID_HEX_LENGTH),
      derivedSpanId: sha256Hex(
        `${sessionId}:${promptId}:${eventName}:${eventSequence}`,
      ).slice(0, SPAN_ID_HEX_LENGTH),
      derivedFrom: "session.id",
    });
  }

  // codex: trace keyed on conversation.id (groups a multi-turn chat into
  // one trace), one span per event. Scope-agnostic; gated on the
  // `codex.*` event.name prefix which is stable across builds.
  const conversationId = attrs["conversation.id"];
  if (eventName.startsWith(CODEX_EVENT_NAME_PREFIX) && conversationId) {
    return combine({
      wireTraceId,
      wireSpanId,
      derivedTraceId: sha256Hex(conversationId).slice(0, TRACE_ID_HEX_LENGTH),
      derivedSpanId: sha256Hex(
        `${conversationId}:${eventName}:${eventSequence}`,
      ).slice(0, SPAN_ID_HEX_LENGTH),
      derivedFrom: "conversation.id",
    });
  }

  // Not a documented coding-agent shape: leave the (empty) wire ids
  // unchanged rather than guessing a grouping from generic keys.
  return passthrough(wireTraceId, wireSpanId);
}
