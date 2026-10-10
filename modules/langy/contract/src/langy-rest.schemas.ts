import type { Named } from "@langwatch/module";
import { z } from "zod";

import { cliToolResultSchema, type CliToolResult } from "./cards/tool-result.ts";
import {
  startCallBodySchema,
  startWaitBodySchema,
} from "./features/local-control/langy.local-control-http.ts";
import {
  cliFrameSchema,
  platformFrameSchema,
  refusedFrameSchema,
  registeredFrameSchema,
} from "./features/local-control/langy.local-control-protocol.ts";
import { langyMessagePartSchema } from "./json.ts";

// ── internal control-plane (the Go agent's outbound calls) ─────────────────

/**
 * A tool call the agent ran, as posted with a completed turn. `output` doubles
 * as the error text when `isError` (a single wire field).
 */
const langyTurnResultToolCallSchemaDefinition = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  /** Canonical typed result; optional only for older workers during rollout. */
  result: z
    .custom<CliToolResult>(
      (value) => cliToolResultSchema.validate(value),
      "Invalid CLI tool result",
    )
    .optional(),
});
export interface LangyTurnResultToolCallSchema extends Named<
  typeof langyTurnResultToolCallSchemaDefinition
> {}
export const langyTurnResultToolCallSchema: LangyTurnResultToolCallSchema =
  langyTurnResultToolCallSchemaDefinition;

const langyTurnResultSchemaDefinition = z.object({
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
export interface LangyTurnResultSchema extends Named<typeof langyTurnResultSchemaDefinition> {}
export const langyTurnResultSchema: LangyTurnResultSchema = langyTurnResultSchemaDefinition;

/** The turn one durable ingest names in its path. */
const langyInternalTurnParamsSchemaDefinition = z.object({ turnId: z.string().min(1) });
export interface LangyInternalTurnParamsSchema extends Named<
  typeof langyInternalTurnParamsSchemaDefinition
> {}
export const langyInternalTurnParamsSchema: LangyInternalTurnParamsSchema =
  langyInternalTurnParamsSchemaDefinition;

/** What a durable turn result answers once it is recorded. */
const langyInternalAcceptedSchemaDefinition = z.object({ status: z.literal("accepted") });
export interface LangyInternalAcceptedSchema extends Named<
  typeof langyInternalAcceptedSchemaDefinition
> {}
export const langyInternalAcceptedSchema: LangyInternalAcceptedSchema =
  langyInternalAcceptedSchemaDefinition;

/** What a revoke answers: the state the key is now in, however it got there. */
const langyInternalRevokedSchemaDefinition = z.object({
  outcome: z.enum(["revoked", "already_revoked", "not_found"]),
});
export interface LangyInternalRevokedSchema extends Named<
  typeof langyInternalRevokedSchemaDefinition
> {}
export const langyInternalRevokedSchema: LangyInternalRevokedSchema =
  langyInternalRevokedSchemaDefinition;

/** The bare `{ error }` body this control plane's refusals have always carried. */
const langyInternalRefusalSchemaDefinition = z.object({ error: z.string() });
export interface LangyInternalRefusalSchema extends Named<
  typeof langyInternalRefusalSchemaDefinition
> {}
export const langyInternalRefusalSchema: LangyInternalRefusalSchema =
  langyInternalRefusalSchemaDefinition;

const langyRevokeCredentialsSchemaDefinition = z.object({
  apiKeyId: z.string().min(1).max(128),
  // The tenant the key belongs to. Required so the revoke is scoped to one
  // project - without it a bearer-secret holder could revoke any tenant's live
  // session key by id alone.
  projectId: z.string().min(1).max(128),
});
export interface LangyRevokeCredentialsSchema extends Named<
  typeof langyRevokeCredentialsSchemaDefinition
> {}
export const langyRevokeCredentialsSchema: LangyRevokeCredentialsSchema =
  langyRevokeCredentialsSchemaDefinition;

// ── the worker's local-control door ─────────────────────────────────────────

const langyLocalConversationBodySchemaDefinition = z.object({
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  /** The worker's own tool call, so the card renders where the work is. */
  toolCallId: z.string().min(1).optional(),
});
export interface LangyLocalConversationBodySchema extends Named<
  typeof langyLocalConversationBodySchemaDefinition
> {}
export const langyLocalConversationBodySchema: LangyLocalConversationBodySchema =
  langyLocalConversationBodySchemaDefinition;

/** The call a poll and a cancel name in the path. */
const langyLocalCallIdParamsSchemaDefinition = z.object({ callId: z.string().min(1) });
export interface LangyLocalCallIdParamsSchema extends Named<
  typeof langyLocalCallIdParamsSchemaDefinition
> {}
export const langyLocalCallIdParamsSchema: LangyLocalCallIdParamsSchema =
  langyLocalCallIdParamsSchemaDefinition;

/** The wait a poll names in the path. */
const langyLocalWaitIdParamsSchemaDefinition = z.object({ waitId: z.string().min(1) });
export interface LangyLocalWaitIdParamsSchema extends Named<
  typeof langyLocalWaitIdParamsSchemaDefinition
> {}
export const langyLocalWaitIdParamsSchema: LangyLocalWaitIdParamsSchema =
  langyLocalWaitIdParamsSchemaDefinition;

/** The conversation a code-access status read optionally narrows to. */
const langyLocalWorkspaceQuerySchemaDefinition = z.object({
  conversationId: z.string().optional(),
});
export interface LangyLocalWorkspaceQuerySchema extends Named<
  typeof langyLocalWorkspaceQuerySchemaDefinition
> {}
export const langyLocalWorkspaceQuerySchema: LangyLocalWorkspaceQuerySchema =
  langyLocalWorkspaceQuerySchemaDefinition;

/** The conversation a code-access request is raised against. */
const langyLocalCreateRequestBodySchemaDefinition = z.object({
  conversationId: z.string().min(1),
});
export interface LangyLocalCreateRequestBodySchema extends Named<
  typeof langyLocalCreateRequestBodySchemaDefinition
> {}
export const langyLocalCreateRequestBodySchema: LangyLocalCreateRequestBodySchema =
  langyLocalCreateRequestBodySchemaDefinition;

const langyLocalStartCallRequestSchemaDefinition =
  langyLocalConversationBodySchema.and(startCallBodySchema);
export interface LangyLocalStartCallRequestSchema extends Named<
  typeof langyLocalStartCallRequestSchemaDefinition
> {}
export const langyLocalStartCallRequestSchema: LangyLocalStartCallRequestSchema =
  langyLocalStartCallRequestSchemaDefinition;
const langyLocalStartWaitRequestSchemaDefinition = z.object({
  ...langyLocalConversationBodySchema.shape,
  ...startWaitBodySchema.shape,
});
export interface LangyLocalStartWaitRequestSchema extends Named<
  typeof langyLocalStartWaitRequestSchemaDefinition
> {}
export const langyLocalStartWaitRequestSchema: LangyLocalStartWaitRequestSchema =
  langyLocalStartWaitRequestSchemaDefinition;

// ── the local-control REST family, `/api/langy/control` ────────────────────

const langyControlIdParamsSchemaDefinition = z.object({
  requestId: z.string().min(1).describe("The control request id."),
});
export interface LangyControlIdParamsSchema extends Named<
  typeof langyControlIdParamsSchemaDefinition
> {}
export const langyControlIdParamsSchema: LangyControlIdParamsSchema =
  langyControlIdParamsSchemaDefinition;

const langyControlCancelResultSchemaDefinition = z.object({
  id: z.string().describe("The request that was cancelled."),
  cancelled: z.literal(true).describe("Always true once the request is gone."),
});
export interface LangyControlCancelResultSchema extends Named<
  typeof langyControlCancelResultSchemaDefinition
> {}
export const langyControlCancelResultSchema: LangyControlCancelResultSchema =
  langyControlCancelResultSchemaDefinition;

const langyControlRegisterAnswerSchemaDefinition = z.object({
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
export interface LangyControlRegisterAnswerSchema extends Named<
  typeof langyControlRegisterAnswerSchemaDefinition
> {}
export const langyControlRegisterAnswerSchema: LangyControlRegisterAnswerSchema =
  langyControlRegisterAnswerSchemaDefinition;

const langyControlPollAnswerSchemaDefinition = z.object({
  frames: z
    .array(platformFrameSchema)
    .describe("The frames waiting for the folder; empty once the poll wait passes with none."),
});
export interface LangyControlPollAnswerSchema extends Named<
  typeof langyControlPollAnswerSchemaDefinition
> {}
export const langyControlPollAnswerSchema: LangyControlPollAnswerSchema =
  langyControlPollAnswerSchemaDefinition;

const langyControlFramesBodySchemaDefinition = z.object({
  frames: z
    .array(cliFrameSchema)
    .min(1)
    .max(100)
    .describe("Ack, result, permission_required and deregister frames, in order."),
});
export interface LangyControlFramesBodySchema extends Named<
  typeof langyControlFramesBodySchemaDefinition
> {}
export const langyControlFramesBodySchema: LangyControlFramesBodySchema =
  langyControlFramesBodySchemaDefinition;

const langyControlFramesAnswerSchemaDefinition = z.object({
  accepted: z.number().int().describe("How many frames were taken."),
});
export interface LangyControlFramesAnswerSchema extends Named<
  typeof langyControlFramesAnswerSchemaDefinition
> {}
export const langyControlFramesAnswerSchema: LangyControlFramesAnswerSchema =
  langyControlFramesAnswerSchemaDefinition;

const langyControlPollQuerySchemaDefinition = z.object({
  inFlight: z.string().optional().describe("Comma-separated call ids this folder still holds."),
});
export interface LangyControlPollQuerySchema extends Named<
  typeof langyControlPollQuerySchemaDefinition
> {}
export const langyControlPollQuerySchema: LangyControlPollQuerySchema =
  langyControlPollQuerySchemaDefinition;

// ── the public project-API-key turn surface ─────────────────────────────────

/**
 * One user turn on the wire. Parts stay opaque; the app layer bounds them. `content` is the
 * plain-text shorthand a generic HTTP client (a script, a scenario HTTP agent's body template)
 * can produce without restructuring its own message shape; it normalizes to a single text part.
 */
const langyRestTurnMessageSchemaDefinition = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(langyMessagePartSchema).optional(),
    content: z.string().optional(),
  })
  .transform(({ role, parts, content }) => ({
    role,
    parts: parts ?? (content === undefined ? [] : [{ type: "text", text: content }]),
  }));
export interface LangyRestTurnMessageSchema extends Named<
  typeof langyRestTurnMessageSchemaDefinition
> {}
export const langyRestTurnMessageSchema: LangyRestTurnMessageSchema =
  langyRestTurnMessageSchemaDefinition;

/** The conversation a turn route addresses, off the path. */
const langyRestConversationParamsSchemaDefinition = z.object({
  conversationId: z.string().min(1),
});
export interface LangyRestConversationParamsSchema extends Named<
  typeof langyRestConversationParamsSchemaDefinition
> {}
export const langyRestConversationParamsSchema: LangyRestConversationParamsSchema =
  langyRestConversationParamsSchemaDefinition;

const langyRestTurnBodySchemaDefinition = z.object({
  messages: z.array(langyRestTurnMessageSchema).min(1),
  idempotencyKey: z.string().min(1),
  modelOverride: z.string().min(1).optional(),
  /**
   * Adopt the path's conversation id as a NEW conversation when it does not exist yet, instead
   * of minting a fresh one.
   */
  adoptConversationId: z.boolean().optional(),
});
export interface LangyRestTurnBodySchema extends Named<typeof langyRestTurnBodySchemaDefinition> {}
export const langyRestTurnBodySchema: LangyRestTurnBodySchema = langyRestTurnBodySchemaDefinition;

// ── the agent-to-page UI-action dispatch surface ────────────────────────────

const langyUiActionDispatchBodySchemaDefinition = z.object({
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
export interface LangyUiActionDispatchBodySchema extends Named<
  typeof langyUiActionDispatchBodySchemaDefinition
> {}
export const langyUiActionDispatchBodySchema: LangyUiActionDispatchBodySchema =
  langyUiActionDispatchBodySchemaDefinition;

const langyRelayTallySchemaDefinition = z.object({
  applied: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  terminal: z.boolean(),
});
export interface LangyRelayTallySchema extends Named<typeof langyRelayTallySchemaDefinition> {}
export const langyRelayTallySchema: LangyRelayTallySchema = langyRelayTallySchemaDefinition;
export type RelayTally = z.infer<typeof langyRelayTallySchema>;
