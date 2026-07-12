/**
 * The wire shapes the Langy relay ingests (LANGY_WORKER_REDESIGN_PLAN §0/§0a).
 *
 * The worker streams one ndjson line per frame. Each line is a
 * `LangyFrameEnvelope`: the authenticated identity + nonce + an opaque `payload`
 * string + its HMAC. The relay verifies the envelope (langyFrameAuth), then
 * parses `payload` into a `LangyRelayFrame` — the typed, EXTENSIBLE union of
 * everything the worker can emit: token deltas, status/progress, tool-call
 * lifecycle, heartbeats, UI cards, and the two terminals (final / error).
 *
 * Splitting the two schemas keeps the security boundary crisp: the envelope is
 * verified as bytes BEFORE its payload is trusted or parsed.
 */
import { z } from "zod";

/**
 * The signed envelope — mirrors frameauth's construction. `payload` is the exact
 * string that was signed; it is re-verified verbatim, then parsed separately.
 */
export const langyFrameEnvelopeSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  frameNonce: z.string().min(1),
  payload: z.string(),
  mac: z.string().min(1),
});
export type LangyFrameEnvelope = z.infer<typeof langyFrameEnvelopeSchema>;

/** A tool call the agent ran, in the compact shape the durable final carries. */
export const langyRelayToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
});

/**
 * The typed payload union. `type` discriminates; the union is deliberately open
 * to new UI cards (a card is not a special case — it rides the same stream,
 * ordering, and HMAC as a token). `final`/`error` are the two terminals.
 */
export const langyRelayFrameSchema = z.discriminatedUnion("type", [
  /** A buffered run of assistant prose. */
  z.object({ type: z.literal("delta"), text: z.string() }),
  /** Ephemeral "major update" — which tool/action the agent is picking. */
  z.object({ type: z.literal("status"), status: z.string() }),
  /** Ephemeral "sub update" — how far through a subtask the agent is. */
  z.object({
    type: z.literal("progress"),
    message: z.string().optional(),
    progress: z.number().optional(),
  }),
  /**
   * A keep-alive so a long, silent tool call still refreshes liveness. Carries
   * no content; it only advances the turn's freshness.
   */
  z.object({ type: z.literal("heartbeat") }),
  /**
   * A UI card to render inline, mid-stream (e.g. "downloading a trace"). `kind`
   * names the card; `detail`/`data` are card-specific. Open by design — a new
   * card is a new `kind`, not a new frame type.
   */
  z.object({
    type: z.literal("card"),
    kind: z.string().min(1),
    detail: z.string().optional(),
    data: z.unknown().optional(),
  }),
  /** Tool-call lifecycle — a live card AND a durable milestone event. */
  z.object({
    type: z.literal("tool"),
    id: z.string().min(1),
    name: z.string().min(1),
    phase: z.enum(["start", "end"]),
    title: z.string().optional(),
    command: z.string().optional(),
    input: z.unknown().optional(),
    output: z.string().optional(),
    isError: z.boolean().optional(),
    durationMs: z.number().optional(),
  }),
  /** Terminal success — carries the durable final answer. */
  z.object({
    type: z.literal("final"),
    text: z.string().optional(),
    toolCalls: z.array(langyRelayToolCallSchema).optional(),
  }),
  /** Terminal failure — carries a vetted error code, never raw prose. */
  z.object({
    type: z.literal("error"),
    error: z.string(),
    code: z.string().optional(),
  }),
  /**
   * Terminal handoff (ADR-048): the worker checkpointed the in-flight turn on a
   * shutdown-imminent notice and hands back an opaque resume token the control
   * plane persists, so the NEXT turn resumes from it. Ends the live stream; the
   * token is durable, never rendered.
   */
  z.object({
    type: z.literal("handoff"),
    resumeToken: z.string().optional(),
  }),
]);
export type LangyRelayFrame = z.infer<typeof langyRelayFrameSchema>;
export type LangyRelayToolCall = z.infer<typeof langyRelayToolCallSchema>;
