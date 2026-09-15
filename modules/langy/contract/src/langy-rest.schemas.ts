import { z } from "zod";
import { cliToolResultSchema, type CliToolResult } from "./cards/tool-result.ts";
import { startCallBodySchema, startWaitBodySchema } from "./langy.local-control-http.ts";
import {
  cliFrameSchema,
  platformFrameSchema,
  refusedFrameSchema,
  registeredFrameSchema,
} from "./langy.local-control-protocol.ts";
import { langyMessagePartSchema } from "./json.ts";

// ── internal control-plane (the Go agent's outbound calls) ─────────────────

/**
 * A tool call the agent ran, as posted with a completed turn. `output` doubles
 * as the error text when `isError` (a single wire field).
 */
export const langyTurnResultToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  /** Canonical typed result; optional only for older workers during rollout. */
  result: z
    .custom<CliToolResult>(
      (value) => cliToolResultSchema.safeParse(value).success,
      "Invalid CLI tool result",
    )
    .optional(),
});

export const langyTurnResultSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  /** The final assistant prose. Present (possibly empty) on `completed`. */
  text: z.string().optional(),
  toolCalls: z.array(langyTurnResultToolCallSchema).optional(),
  /**
   * A terminal error code the agent emits on its error frames (e.g.
   * `at-capacity`, `session-not-found`, `worker_spawn_failed`). Mapped to a
   * vetted domain error server-side; never raw prose. Present on `failed`.
   */
  errorCode: z.string().optional(),
});

/** The turn one durable ingest names in its path. */
export const langyInternalTurnParamsSchema = z.object({ turnId: z.string().min(1) });

/** What a durable turn result answers once it is recorded. */
export const langyInternalAcceptedSchema = z.object({ status: z.literal("accepted") });

/** What a revoke answers: the state the key is now in, however it got there. */
export const langyInternalRevokedSchema = z.object({
  outcome: z.enum(["revoked", "already_revoked", "not_found"]),
});

/** The bare `{ error }` body this control plane's refusals have always carried. */
export const langyInternalRefusalSchema = z.object({ error: z.string() });

export const langyRevokeCredentialsSchema = z.object({
  apiKeyId: z.string().min(1).max(128),
  // The tenant the key belongs to. Required so the revoke is scoped to one
  // project - without it a bearer-secret holder could revoke any tenant's live
  // session key by id alone.
  projectId: z.string().min(1).max(128),
});

// ── the worker's local-control door ─────────────────────────────────────────

export const langyLocalConversationBodySchema = z.object({
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  /** The worker's own tool call, so the card renders where the work is. */
  toolCallId: z.string().min(1).optional(),
});

/** The call or wait a poll and a cancel name in the path. */
export const langyLocalCallIdParamsSchema = z.object({ id: z.string().min(1) });

export const langyLocalStartCallRequestSchema =
  langyLocalConversationBodySchema.and(startCallBodySchema);
export const langyLocalStartWaitRequestSchema =
  langyLocalConversationBodySchema.and(startWaitBodySchema);

// ── the local-control REST family, `/api/langy/control` ────────────────────

export const langyControlIdParamsSchema = z.object({
  id: z.string().min(1).describe("The control request id."),
});

export const langyControlCancelResultSchema = z.object({
  id: z.string().describe("The request that was cancelled."),
  cancelled: z.literal(true).describe("Always true once the request is gone."),
});

export const langyControlRegisterAnswerSchema = z.object({
  frame: z
    .union([registeredFrameSchema, refusedFrameSchema])
    .describe("The registered frame, or the refused frame with its reason."),
  instanceToken: z
    .string()
    .optional()
    .describe(
      "The token the poll and frames endpoints are addressed with, in the " +
        "X-Agent-Instance-Token header. Present when the register was accepted.",
    ),
});

export const langyControlPollAnswerSchema = z.object({
  frames: z
    .array(platformFrameSchema)
    .describe("The frames waiting for the folder; empty once the poll wait passes with none."),
});

export const langyControlFramesBodySchema = z.object({
  frames: z
    .array(cliFrameSchema)
    .min(1)
    .max(100)
    .describe("Ack, result, permission_required and deregister frames, in order."),
});

export const langyControlFramesAnswerSchema = z.object({
  accepted: z.number().int().describe("How many frames were taken."),
});

export const langyControlPollQuerySchema = z.object({
  inFlight: z.string().optional().describe("Comma-separated call ids this folder still holds."),
});

// ── the public project-API-key turn surface ─────────────────────────────────

/**
 * One user turn on the wire. Parts stay opaque; the app layer bounds them. `content` is the
 * plain-text shorthand a generic HTTP client (a script, a scenario HTTP agent's body template)
 * can produce without restructuring its own message shape; it normalizes to a single text part.
 */
export const langyRestTurnMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(langyMessagePartSchema).optional(),
    content: z.string().optional(),
  })
  .transform(({ role, parts, content }) => ({
    role,
    parts: parts ?? (content === undefined ? [] : [{ type: "text", text: content }]),
  }));

export const langyRestTurnBodySchema = z.object({
  messages: z.array(langyRestTurnMessageSchema).min(1),
  idempotencyKey: z.string().min(1),
  modelOverride: z.string().min(1).optional(),
  /**
   * Adopt the path's conversation id as a NEW conversation when it does not exist yet, instead
   * of minting a fresh one.
   */
  adoptConversationId: z.boolean().optional(),
});

// ── the agent-to-page UI-action dispatch surface ────────────────────────────

export const langyUiActionDispatchBodySchema = z.object({
  conversationId: z.string().min(1),
  kind: z.string().min(1),
  payload: z.unknown().optional(),
  /**
   * Which experiment a backend fallback applies the action to. The browser
   * path ignores it (the open page IS the experiment); without it a fallback
   * for a workbench action refuses with `langy_ui_experiment_required`.
   */
  experimentSlug: z.string().min(1).optional(),
});
