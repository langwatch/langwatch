/** Wire shapes the Langy relay ingests (langyTurnRelay.ts). Each line is a LangyFrameEnvelope
 * (identity + nonce + opaque payload + HMAC). Relay verifies envelope, parses payload into
 * typed LangyRelayFrame. Two schemas split the security boundary crisply. */
import {
  type HandledError,
  type HerrEnvelope,
  handledErrorFromHerr,
} from "@langwatch/handled-error";
import { cliToolResultSchema } from "@langwatch/langy-contract";
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

/** Go pkg/herr wire envelope, deserialized at boundary: herr and HandledError are the same
 * model, so schema transforms envelope into HandledError. Guarantees only known codes/copy. */
const herrEnvelopeWireSchema: z.ZodType<HerrEnvelope> = z.lazy(() =>
  z.object({
    type: z.string(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    fault: z.enum(["customer", "platform", "provider"]).optional(),
    retryable: z.boolean().optional(),
    tips: z.array(z.string()).optional(),
    docs_url: z.string().optional(),
    reasons: z.array(herrEnvelopeWireSchema).optional(),
  }),
);
function receivedDomainErrorFromHerr(body: HerrEnvelope): HandledError {
  return handledErrorFromHerr(body);
}
interface ReceivedDomainError extends HandledError {}
const receivedDomainErrorSchema: z.ZodType<ReceivedDomainError> = herrEnvelopeWireSchema.transform(
  receivedDomainErrorFromHerr,
);

/**
 * The separator a model provider's round-trip blob is stapled onto a tool call
 * id with. Gemini's thought signature is the one that reached us: the agent
 * runtime has nowhere else to carry it, so it emits `<real id>_ts_<blob>`.
 */
const TOOL_CALL_ID_SIGNATURE_SEPARATOR = "_ts_";

/**
 * The shortest suffix we will treat as a stapled blob rather than as part of a
 * name. A real signature is kilobytes of base64; this only has to be past
 * anything a provider would plausibly put after an underscore.
 */
const TOOL_CALL_ID_SIGNATURE_MIN_LENGTH = 64;

/** base64url — what a stapled blob is encoded as, and what a name is not. */
const TOOL_CALL_ID_SIGNATURE_SHAPE = /^[A-Za-z0-9_-]+$/;

/**
 * Past this, the value is not an identifier and we do not want it in the event
 * log, the message parts, or a composed idempotency key. Real ids are well
 * under a hundred characters.
 */
const TOOL_CALL_ID_MAX_LENGTH = 256;

/** Strip a model provider's round-trip payload from tool call ids. Normalize here to keep
 * start/end/cards/events aligned (specs/langy/langy-tool-call-identity.feature). */
export function normalizeToolCallId(id: string): string {
  const separator = id.indexOf(TOOL_CALL_ID_SIGNATURE_SEPARATOR);
  if (separator <= 0) return id;
  const suffix = id.slice(separator + TOOL_CALL_ID_SIGNATURE_SEPARATOR.length);
  if (suffix.length < TOOL_CALL_ID_SIGNATURE_MIN_LENGTH) return id;
  if (!TOOL_CALL_ID_SIGNATURE_SHAPE.test(suffix)) return id;
  return id.slice(0, separator);
}

/**
 * A tool call's id, normalised at the boundary. The length bound applies
 * AFTER stripping, so a legitimate id wearing a signature isn't rejected
 * for the blob's length; a value still over it is REJECTED, never truncated.
 */
export const langyToolCallIdSchema = z
  .string()
  .min(1)
  .transform(normalizeToolCallId)
  .pipe(z.string().min(1).max(TOOL_CALL_ID_MAX_LENGTH));

/** A tool call the agent ran, in the compact shape the durable final carries. */
export const langyRelayToolCallSchema = z.object({
  id: langyToolCallIdSchema,
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  result: cliToolResultSchema.optional(),
  local: z.boolean().optional(),
});

/**
 * The typed payload union. `type` discriminates; the union is deliberately open
 * to new UI cards (a card is not a special case — it rides the same stream,
 * ordering, and HMAC as a token). `final`/`error` are the two terminals.
 */
const langyRelayFrameVariants = [
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
  /** Full snapshot of agent's plan (todo list) from settled todowrite tool part.
   * Snapshot-typed, idempotent under frameNonce. Both live buffer and durable plan_updated event.
   * Model-authored text, capped by relay (defence in depth). */
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
  /**
   * Tool-call lifecycle: a live card and a durable milestone event. `local`
   * means the call ran in the folder the developer shared (ADR-129), which the
   * name cannot say — the shell that delegates there is registered as `bash`.
   */
  z.object({
    type: z.literal("tool"),
    id: langyToolCallIdSchema,
    name: z.string().min(1),
    phase: z.enum(["start", "end"]),
    title: z.string().optional(),
    command: z.string().optional(),
    input: z.unknown().optional(),
    output: z.string().optional(),
    isError: z.boolean().optional(),
    result: cliToolResultSchema.optional(),
    durationMs: z.number().optional(),
    local: z.boolean().optional(),
  }),
  /** Terminal success — carries the durable final answer. */
  z.object({
    type: z.literal("final"),
    text: z.string().optional(),
    toolCalls: z.array(langyRelayToolCallSchema).optional(),
  }),
  /**
   * Terminal failure — a vetted error code, never raw prose. `herr` is the
   * full typed cause chain when known, already deserialized into a
   * HandledError so the classifier can name the REAL failure.
   */
  z.object({
    type: z.literal("error"),
    error: z.string(),
    code: z.string().optional(),
    herr: receivedDomainErrorSchema.optional(),
  }),
  /**
   * Terminal handoff (ADR-048): the worker checkpointed the in-flight turn
   * on a shutdown-imminent notice and hands back an opaque resume token the
   * control plane persists so the NEXT turn resumes from it. Never rendered.
   */
  z.object({
    type: z.literal("handoff"),
    resumeToken: z.string().optional(),
  }),
] as const;
export type LangyRelayFrame = z.output<(typeof langyRelayFrameVariants)[number]>;
export const langyRelayFrameSchema: z.ZodType<LangyRelayFrame> = z.discriminatedUnion(
  "type",
  langyRelayFrameVariants,
);
export type LangyRelayToolCall = z.infer<typeof langyRelayToolCallSchema>;
