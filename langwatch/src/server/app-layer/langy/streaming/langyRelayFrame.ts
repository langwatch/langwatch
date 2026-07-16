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
// zod/v4, not the default v3 entrypoint: `cliToolResultSchema` below is authored
// against zod/v4, and a v4 schema embedded in a v3 `z.object()` blows up at parse
// time (`keyValidator._parse is not a function`) rather than at construction.
import * as z from "zod/v4";
import { cliToolResultSchema } from "@langwatch/cli-cards";

import {
  handledErrorFromHerr,
  type HerrEnvelope,
} from "~/server/app-layer/handled-error";

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

/**
 * The Go pkg/herr wire envelope, validated and DESERIALIZED AT THE BOUNDARY:
 * herr and HandledError are the SAME model (type ⇄ kind, meta, trace ids,
 * recursive reasons), so the schema transforms the envelope straight into a
 * real HandledError — downstream code only ever sees a HandledError and never
 * thinks about the wire dialect. herr guarantees the envelope carries only
 * our own services' known codes/copy; unknown causes arrive pre-collapsed to
 * type "unknown".
 */
const herrEnvelopeWireSchema: z.ZodType<HerrEnvelope> = z.lazy(() =>
  z.object({
    type: z.string(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    reasons: z.array(herrEnvelopeWireSchema).optional(),
  }),
);
const receivedDomainErrorSchema = herrEnvelopeWireSchema.transform(
  handledErrorFromHerr,
);

/** A tool call the agent ran, in the compact shape the durable final carries. */
export const langyRelayToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  result: cliToolResultSchema.optional(),
});

/**
 * The typed payload union. `type` discriminates; the union is deliberately open
 * to new UI cards (a card is not a special case — it rides the same stream,
 * ordering, and HMAC as a token). `final`/`error` are the two terminals.
 */
export const langyRelayFrameSchema = z.discriminatedUnion("type", [
  /** A buffered run of assistant prose. */
  z.object({ type: z.literal("delta"), text: z.string() }),
  /**
   * Ephemeral run of the model's REASONING (thinking) tokens. Live edge ONLY:
   * relayed while it streams and dropped when the turn settles — never a message
   * part, never durable, never on the final. Same ordering + HMAC as a delta.
   */
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  /** Ephemeral "major update" — which tool/action the agent is picking. */
  z.object({ type: z.literal("status"), status: z.string() }),
  /** Ephemeral "sub update" — how far through a subtask the agent is. */
  z.object({
    type: z.literal("progress"),
    message: z.string().optional(),
    progress: z.number().optional(),
    current: z.number().int().nonnegative().optional(),
    total: z.number().int().positive().optional(),
    batchItems: z.number().int().positive().optional(),
    batchDurationMs: z.number().int().positive().optional(),
  }),
  /**
   * A keep-alive so a long, silent tool call still refreshes liveness. Carries
   * no content; it only advances the turn's freshness.
   */
  z.object({ type: z.literal("heartbeat") }),
  /**
   * A FULL SNAPSHOT of the agent's plan (its todo list), derived by the manager
   * from a settled `todowrite` tool part and mirrored as the panel's live
   * checklist. Snapshot-typed and idempotent under frameNonce dedup — the whole
   * list rides each frame, last-snapshot-wins, no patching. `status` is kept as
   * a permissive string (the client tolerates an unknown value as pending). Both
   * a live buffer entry AND a durable `plan_updated` event.
   *
   * Plan items are MODEL-AUTHORED text, so the relay caps count and length here
   * (defence in depth — the manager already caps to 30 items / 200 chars, so a
   * legitimate frame never approaches these bounds; a frame that does is a buggy
   * or hostile source and is REJECTED as an invalid payload, not truncated).
   */
  z.object({
    type: z.literal("plan"),
    items: z
      .array(
        z.object({
          content: z.string().max(500),
          status: z.string().max(40),
        }),
      )
      .max(50),
  }),
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
    result: cliToolResultSchema.optional(),
    durationMs: z.number().optional(),
  }),
  /** Terminal success — carries the durable final answer. */
  z.object({
    type: z.literal("final"),
    text: z.string().optional(),
    toolCalls: z.array(langyRelayToolCallSchema).optional(),
  }),
  /**
   * Terminal failure — carries a vetted error code, never raw prose. `herr`
   * is the failure's full typed cause chain when the manager knows it (e.g.
   * `agent_error` with the gateway's `no_provider_configured` as a reason),
   * already deserialized into a HandledError by the schema, letting the
   * classifier name the REAL failure.
   */
  z.object({
    type: z.literal("error"),
    error: z.string(),
    code: z.string().optional(),
    herr: receivedDomainErrorSchema.optional(),
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
