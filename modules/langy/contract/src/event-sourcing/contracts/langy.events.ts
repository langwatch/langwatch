import type { Named } from "@langwatch/module";
/**
 * Event PAYLOAD schemas for the `langy_conversation` aggregate (ADR-046) —
 * shared by the server pipeline and the browser fold (ADR-059). Pure Zod, no
 * branding; the full envelope (TenantId, AggregateType) stays server-side.
 */
import { z } from "zod";

import { LANGY_CONVERSATION_ORIGINS } from "../../constants.ts";
import {
  langyJsonValueSchema,
  langyMessagePartSchema,
  langyMessageRoleSchema,
} from "../../json.ts";

/**
 * ConversationStarted — explicit creation event, sets owner (first-writer-
 * wins) and optional title BEFORE any message. Feeds the conversation spine
 * fold only — no message row, no turn document.
 */
const langyConversationStartedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set once (first-writer-wins). */
  userId: z.string(),
  /** Optional initial title (else derived from the first message). */
  title: z.string().nullable().optional(),
  /**
   * The per-conversation `runToken` (`streaming/langyFrameAuth.ts`): HMACs
   * worker frames. SERVER-ONLY — never re-sent on the wire, never in a
   * client-facing projection.
   */
  runToken: z.string().nullable().optional(),
  /** Absent on a conversation started before origins existed, which reads as interactive. */
  origin: z.enum(LANGY_CONVERSATION_ORIGINS).optional(),
});
export interface LangyConversationStartedEventDataSchema extends Named<
  typeof langyConversationStartedEventDataSchemaDefinition
> {}
export const langyConversationStartedEventDataSchema: LangyConversationStartedEventDataSchema =
  langyConversationStartedEventDataSchemaDefinition;
export type LangyConversationStartedEventData = z.infer<
  typeof langyConversationStartedEventDataSchema
>;

/**
 * ConversationForked — a fresh user-owned aggregate branched from a visible
 * conversation. Imported transcript rows arrive as explicit
 * `message_imported` events, so a replay never re-reads the source.
 */
const langyConversationForkedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  sourceConversationId: z.string(),
  userId: z.string(),
  title: z.string().nullable(),
  runToken: z.string(),
  /** Set to `run` when the source is a run: a copy of its history keeps the run's limits. */
  origin: z.enum(LANGY_CONVERSATION_ORIGINS).optional(),
});
export interface LangyConversationForkedEventDataSchema extends Named<
  typeof langyConversationForkedEventDataSchemaDefinition
> {}
export const langyConversationForkedEventDataSchema: LangyConversationForkedEventDataSchema =
  langyConversationForkedEventDataSchemaDefinition;
export type LangyConversationForkedEventData = z.infer<
  typeof langyConversationForkedEventDataSchema
>;

/**
 * MessageRecorded — a user (or system) message was added to the
 * conversation. Feeds both operational conversation state (owner, title,
 * activity, count) and the message projection. `parts` is opaque to the pipeline.
 */
const langyMessageRecordedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set from the first message only. */
  userId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
  /** Derived from the first user message; operational state keeps the first non-empty. */
  title: z.string().nullable().optional(),
});
export interface LangyMessageRecordedEventDataSchema extends Named<
  typeof langyMessageRecordedEventDataSchemaDefinition
> {}
export const langyMessageRecordedEventDataSchema: LangyMessageRecordedEventDataSchema =
  langyMessageRecordedEventDataSchemaDefinition;
export type LangyMessageRecordedEventData = z.infer<typeof langyMessageRecordedEventDataSchema>;

/**
 * MessageImported — one immutable message copied into a fork. Distinct from
 * `message_recorded`/`agent_responded`: importing must not start a turn,
 * generate a title, or pretend the agent responded.
 */
const langyMessageImportedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  sourceConversationId: z.string(),
  sourceMessageId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
});
export interface LangyMessageImportedEventDataSchema extends Named<
  typeof langyMessageImportedEventDataSchemaDefinition
> {}
export const langyMessageImportedEventDataSchema: LangyMessageImportedEventDataSchema =
  langyMessageImportedEventDataSchemaDefinition;
export type LangyMessageImportedEventData = z.infer<typeof langyMessageImportedEventDataSchema>;

/**
 * AgentTurnAccepted — the turn was durably admitted for dispatch.
 * `questionParts` keeps the per-turn render doc self-contained; `model`
 * (provider-prefixed) becomes the fold's `LastModel`. Both optional.
 */
const langyAgentTurnAcceptedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  questionParts: z.array(langyMessagePartSchema).optional(),
  model: z.string().optional(),
});
export interface LangyAgentTurnAcceptedEventDataSchema extends Named<
  typeof langyAgentTurnAcceptedEventDataSchemaDefinition
> {}
export const langyAgentTurnAcceptedEventDataSchema: LangyAgentTurnAcceptedEventDataSchema =
  langyAgentTurnAcceptedEventDataSchemaDefinition;
export type LangyAgentTurnAcceptedEventData = z.infer<typeof langyAgentTurnAcceptedEventDataSchema>;

/**
 * ToolCallInitiated — the agent began a tool call; treated as liveness.
 * Carries WHAT THE CALL IS DOING (`command`/`input`), not just the tool
 * name — `bash` alone answers nothing. Both optional.
 */
const langyToolCallInitiatedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
});
export interface LangyToolCallInitiatedEventDataSchema extends Named<
  typeof langyToolCallInitiatedEventDataSchemaDefinition
> {}
export const langyToolCallInitiatedEventDataSchema: LangyToolCallInitiatedEventDataSchema =
  langyToolCallInitiatedEventDataSchemaDefinition;
export type LangyToolCallInitiatedEventData = z.infer<typeof langyToolCallInitiatedEventDataSchema>;

/**
 * ToolCallSucceeded — repeats `command` so ONE event answers "what ran, and
 * how long". Errors are a distinct event (`tool_call_failed`), no `isError`.
 */
const langyToolCallSucceededEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
  durationMs: z.number().optional(),
});
export interface LangyToolCallSucceededEventDataSchema extends Named<
  typeof langyToolCallSucceededEventDataSchemaDefinition
> {}
export const langyToolCallSucceededEventDataSchema: LangyToolCallSucceededEventDataSchema =
  langyToolCallSucceededEventDataSchemaDefinition;
export type LangyToolCallSucceededEventData = z.infer<typeof langyToolCallSucceededEventDataSchema>;

/**
 * ToolCallFailed — the failing twin of `tool_call_succeeded`; a call reaches
 * exactly one of the two. `errorText` carries the failure detail, not a bare
 * boolean.
 */
const langyToolCallFailedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
  durationMs: z.number().optional(),
  errorText: z.string().optional(),
});
export interface LangyToolCallFailedEventDataSchema extends Named<
  typeof langyToolCallFailedEventDataSchemaDefinition
> {}
export const langyToolCallFailedEventDataSchema: LangyToolCallFailedEventDataSchema =
  langyToolCallFailedEventDataSchemaDefinition;
export type LangyToolCallFailedEventData = z.infer<typeof langyToolCallFailedEventDataSchema>;

/**
 * PlanUpdated — full snapshot of the agent's `todowrite` plan. Snapshot-
 * typed: each event carries the whole list, fold applies last-write-wins.
 * `status` is a permissive string (unknown reads as pending).
 */
const langyPlanItemSchemaDefinition = z.record(z.string(), langyJsonValueSchema).and(
  z.object({
    content: z.string(),
    status: z.string(),
  }),
);
export interface LangyPlanItemSchema extends Named<typeof langyPlanItemSchemaDefinition> {}
export const langyPlanItemSchema: LangyPlanItemSchema = langyPlanItemSchemaDefinition;
export type LangyPlanItemData = z.infer<typeof langyPlanItemSchema>;

const langyPlanUpdatedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  items: z.array(langyPlanItemSchema).default([]),
});
export interface LangyPlanUpdatedEventDataSchema extends Named<
  typeof langyPlanUpdatedEventDataSchemaDefinition
> {}
export const langyPlanUpdatedEventDataSchema: LangyPlanUpdatedEventDataSchema =
  langyPlanUpdatedEventDataSchemaDefinition;
export type LangyPlanUpdatedEventData = z.infer<typeof langyPlanUpdatedEventDataSchema>;

/**
 * AgentResponseFailed — the response's lifecycle failed with no answer to carry
 * (a stalled/orphaned response the liveness sweep terminalizes). Distinct from
 * `agent_responded`, which carries the completed answer.
 */
const langyAgentResponseFailedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  error: z.string(),
});
export interface LangyAgentResponseFailedEventDataSchema extends Named<
  typeof langyAgentResponseFailedEventDataSchemaDefinition
> {}
export const langyAgentResponseFailedEventDataSchema: LangyAgentResponseFailedEventDataSchema =
  langyAgentResponseFailedEventDataSchemaDefinition;
export type LangyAgentResponseFailedEventData = z.infer<
  typeof langyAgentResponseFailedEventDataSchema
>;

/**
 * AgentResponded — the whole final answer (streamed tokens are NOT events).
 * `outcome`: `completed`, `failed`, or `stopped` (user-stopped, ADR-078).
 */
const langyAgentRespondedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema.default("assistant"),
  parts: z.array(langyMessagePartSchema).default([]),
  outcome: z.enum(["completed", "failed", "stopped"]).default("completed"),
  error: z.string().nullable().optional(),
});
export interface LangyAgentRespondedEventDataSchema extends Named<
  typeof langyAgentRespondedEventDataSchemaDefinition
> {}
export const langyAgentRespondedEventDataSchema: LangyAgentRespondedEventDataSchema =
  langyAgentRespondedEventDataSchemaDefinition;
export type LangyAgentRespondedEventData = z.infer<typeof langyAgentRespondedEventDataSchema>;

/**
 * ConversationArchived — soft-delete. Flips the fold's status/ArchivedAt.
 * No ClickHouse hard-deletion (ADR-046, out of scope).
 */
const langyConversationArchivedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
});
export interface LangyConversationArchivedEventDataSchema extends Named<
  typeof langyConversationArchivedEventDataSchemaDefinition
> {}
export const langyConversationArchivedEventDataSchema: LangyConversationArchivedEventDataSchema =
  langyConversationArchivedEventDataSchemaDefinition;
export type LangyConversationArchivedEventData = z.infer<
  typeof langyConversationArchivedEventDataSchema
>;

/**
 * ConversationMetadataUpdated — rename and/or share toggle. Beyond the
 * prescribed vocabulary; preserves the PATCH route (ADR-046 open question 1).
 * Any field left undefined is unchanged by the fold.
 */
const langyConversationMetadataUpdatedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  title: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
  sharedById: z.string().nullable().optional(),
});
export interface LangyConversationMetadataUpdatedEventDataSchema extends Named<
  typeof langyConversationMetadataUpdatedEventDataSchemaDefinition
> {}
export const langyConversationMetadataUpdatedEventDataSchema: LangyConversationMetadataUpdatedEventDataSchema =
  langyConversationMetadataUpdatedEventDataSchemaDefinition;
export type LangyConversationMetadataUpdatedEventData = z.infer<
  typeof langyConversationMetadataUpdatedEventDataSchema
>;

/**
 * ConversationHandoffPending (ADR-048) — a turn checkpointed on pod
 * termination, leaving an OPAQUE worker-authored resume token. Fold clears
 * CurrentTurnId (handed off, not failed) and returns to idle.
 */
const langyConversationHandoffPendingEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  token: z.string(),
});
export interface LangyConversationHandoffPendingEventDataSchema extends Named<
  typeof langyConversationHandoffPendingEventDataSchemaDefinition
> {}
export const langyConversationHandoffPendingEventDataSchema: LangyConversationHandoffPendingEventDataSchema =
  langyConversationHandoffPendingEventDataSchemaDefinition;
export type LangyConversationHandoffPendingEventData = z.infer<
  typeof langyConversationHandoffPendingEventDataSchema
>;

/**
 * ConversationHandoffConsumed (ADR-048) — the next turn threaded the pending
 * resume token to a fresh worker and cleared it from the fold. Idempotency on
 * the command collapses a double-consume to a single event.
 */
const langyConversationHandoffConsumedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});
export interface LangyConversationHandoffConsumedEventDataSchema extends Named<
  typeof langyConversationHandoffConsumedEventDataSchemaDefinition
> {}
export const langyConversationHandoffConsumedEventDataSchema: LangyConversationHandoffConsumedEventDataSchema =
  langyConversationHandoffConsumedEventDataSchemaDefinition;
export type LangyConversationHandoffConsumedEventData = z.infer<
  typeof langyConversationHandoffConsumedEventDataSchema
>;

/**
 * ConversationTitleGenerated — cheap-model auto title, updates `Title` ONLY
 * when `titleSource !== "user"` (manual rename is sticky). No message row,
 * no activity bump — metadata, not conversational activity.
 */
const langyConversationTitleGeneratedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  /**
   * The finalized turn that triggered this regeneration, when known. Drives
   * idempotency: one title generation per turn, however many times the turn's
   * terminal event is delivered (finalize is at-least-once by design).
   */
  turnId: z.string().optional(),
  title: z.string(),
  /** Always "auto" today — the human rename path is conversation_metadata_updated. */
  source: z.literal("auto").default("auto"),
  /** provider/model id the title was generated with, e.g. "openai/gpt-5-mini". */
  model: z.string(),
});
export interface LangyConversationTitleGeneratedEventDataSchema extends Named<
  typeof langyConversationTitleGeneratedEventDataSchemaDefinition
> {}
export const langyConversationTitleGeneratedEventDataSchema: LangyConversationTitleGeneratedEventDataSchema =
  langyConversationTitleGeneratedEventDataSchemaDefinition;
export type LangyConversationTitleGeneratedEventData = z.infer<
  typeof langyConversationTitleGeneratedEventDataSchema
>;

// ---------------------------------------------------------------------------
// Local control (ADR-129)
// ---------------------------------------------------------------------------

/**
 * What the platform knows about the developer's shared folder. The command
 * line sends it in its register frame, so the skill never spends a turn asking
 * the folder about itself. Everything past `root` is best effort.
 */
const langyLocalWorkspaceSchemaDefinition = z.object({
  root: z.string(),
  name: z.string(),
  hostname: z.string(),
  gitBranch: z.string().optional(),
  gitRemote: z.string().optional(),
  gitDirty: z.boolean().optional(),
  os: z.string().optional(),
  nodeVersion: z.string().optional(),
  pythonVersion: z.string().optional(),
  ghAuthenticated: z.boolean().optional(),
  packageManager: z.string().optional(),
});
export interface LangyLocalWorkspaceSchema extends Named<
  typeof langyLocalWorkspaceSchemaDefinition
> {}
export const langyLocalWorkspaceSchema: LangyLocalWorkspaceSchema =
  langyLocalWorkspaceSchemaDefinition;
export type LangyLocalWorkspaceData = z.infer<typeof langyLocalWorkspaceSchema>;

/**
 * LocalControlRequested — the code access card asked the developer to share a
 * folder. The request is single use and expires; the command line lists it,
 * approves it and gets a session key bound to this conversation.
 */
const langyLocalControlRequestedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  requestId: z.string(),
  /** The user who may approve it. Nobody else ever sees it. */
  userId: z.string(),
  /** Unix ms after which the request is refused. */
  expiresAt: z.number(),
  /** The one command the card shows. */
  command: z.string(),
});
export interface LangyLocalControlRequestedEventDataSchema extends Named<
  typeof langyLocalControlRequestedEventDataSchemaDefinition
> {}
export const langyLocalControlRequestedEventDataSchema: LangyLocalControlRequestedEventDataSchema =
  langyLocalControlRequestedEventDataSchemaDefinition;
export type LangyLocalControlRequestedEventData = z.infer<
  typeof langyLocalControlRequestedEventDataSchema
>;

/** LocalWorkspaceConnected — a folder registered for this conversation. */
const langyLocalWorkspaceConnectedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  requestId: z.string(),
  userId: z.string(),
  instanceId: z.string(),
  workspace: langyLocalWorkspaceSchema,
});
export interface LangyLocalWorkspaceConnectedEventDataSchema extends Named<
  typeof langyLocalWorkspaceConnectedEventDataSchemaDefinition
> {}
export const langyLocalWorkspaceConnectedEventDataSchema: LangyLocalWorkspaceConnectedEventDataSchema =
  langyLocalWorkspaceConnectedEventDataSchemaDefinition;
export type LangyLocalWorkspaceConnectedEventData = z.infer<
  typeof langyLocalWorkspaceConnectedEventDataSchema
>;

/**
 * LocalWorkspaceDisconnected — the folder is gone. `reason` says who ended it,
 * so the card can tell a Ctrl-C from a disconnect the user asked for in the
 * panel, and both from a machine that stopped answering.
 */
const langyLocalWorkspaceDisconnectedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  instanceId: z.string(),
  reason: z.enum(["cli_exit", "panel", "presence_lost"]),
});
export interface LangyLocalWorkspaceDisconnectedEventDataSchema extends Named<
  typeof langyLocalWorkspaceDisconnectedEventDataSchemaDefinition
> {}
export const langyLocalWorkspaceDisconnectedEventDataSchema: LangyLocalWorkspaceDisconnectedEventDataSchema =
  langyLocalWorkspaceDisconnectedEventDataSchemaDefinition;
export type LangyLocalWorkspaceDisconnectedEventData = z.infer<
  typeof langyLocalWorkspaceDisconnectedEventDataSchema
>;

/**
 * LocalPolicyChanged — the developer turned the permission checks off, or back
 * on, for this conversation. `userId` is the consent: the choice is a person's,
 * never the model's.
 */
const langyLocalPolicyChangedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  userId: z.string(),
  skipPermissions: z.boolean(),
  /** The model the gate resolved against when the choice was made. */
  model: z.string().optional(),
});
export interface LangyLocalPolicyChangedEventDataSchema extends Named<
  typeof langyLocalPolicyChangedEventDataSchemaDefinition
> {}
export const langyLocalPolicyChangedEventDataSchema: LangyLocalPolicyChangedEventDataSchema =
  langyLocalPolicyChangedEventDataSchemaDefinition;
export type LangyLocalPolicyChangedEventData = z.infer<
  typeof langyLocalPolicyChangedEventDataSchema
>;

/** One option on a question card. */
const langyUserWaitQuestionOptionSchemaDefinition = z.object({
  label: z.string(),
  description: z.string().optional(),
  /** The way out rather than the way forward: drawn as a quiet link. */
  quiet: z.boolean().optional(),
});
export interface LangyUserWaitQuestionOptionSchema extends Named<
  typeof langyUserWaitQuestionOptionSchemaDefinition
> {}
export const langyUserWaitQuestionOptionSchema: LangyUserWaitQuestionOptionSchema =
  langyUserWaitQuestionOptionSchemaDefinition;

/** One question of a question wait. */
const langyUserWaitQuestionSchemaDefinition = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(langyUserWaitQuestionOptionSchema),
  multiple: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  /** The question is drawn as reply prose above the options, not as a title. */
  bare: z.boolean().optional(),
});
export interface LangyUserWaitQuestionSchema extends Named<
  typeof langyUserWaitQuestionSchemaDefinition
> {}
export const langyUserWaitQuestionSchema: LangyUserWaitQuestionSchema =
  langyUserWaitQuestionSchemaDefinition;

/** What a permission wait shows on its card. */
const langyUserWaitPermissionPayloadSchemaDefinition = z.object({
  callId: z.string(),
  /** The command, as the card prints it. */
  summary: z.string(),
  /** What "allow for this session" would grant. */
  pattern: z.string(),
  /**
   * Every pattern one "allow for this session" answer grants. A chain that
   * fetches and then checks out grants both, and the card's button names all
   * of them, so the answer and the words on it cover the same ground.
   */
  patterns: z.array(z.string()).optional(),
  /** Why the call is not read-only, in one line. */
  reason: z.string(),
  /** The seconds after which the command is stopped, when it runs under one. */
  timeoutSeconds: z.number().optional(),
  /** Whether the card may offer the skip toggle at all. */
  skipOffered: z.boolean(),
  /** The folder the command would run in. */
  workspaceName: z.string(),
  hostname: z.string(),
});
export interface LangyUserWaitPermissionPayloadSchema extends Named<
  typeof langyUserWaitPermissionPayloadSchemaDefinition
> {}
export const langyUserWaitPermissionPayloadSchema: LangyUserWaitPermissionPayloadSchema =
  langyUserWaitPermissionPayloadSchemaDefinition;

/**
 * UserWaitStarted — a tool is waiting for the developer. One primitive behind
 * the permission card and the question card: the durable record is here, and
 * the live stream entry only wakes the panel up.
 */
const langyUserWaitStartedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  waitId: z.string(),
  kind: z.enum(["permission", "question"]),
  /**
   * The tool call that asked. The card rides on it in the turn document, so
   * the panel renders the ask where the work is. Absent when the worker did
   * not name one, and the fold then keys the card by the wait id.
   */
  toolCallId: z.string().optional(),
  /** Unix ms after which the wait gives up and the tool answers in words. */
  expiresAt: z.number(),
  permission: langyUserWaitPermissionPayloadSchema.optional(),
  questions: z.array(langyUserWaitQuestionSchema).optional(),
});
export interface LangyUserWaitStartedEventDataSchema extends Named<
  typeof langyUserWaitStartedEventDataSchemaDefinition
> {}
export const langyUserWaitStartedEventDataSchema: LangyUserWaitStartedEventDataSchema =
  langyUserWaitStartedEventDataSchemaDefinition;
export type LangyUserWaitStartedEventData = z.infer<typeof langyUserWaitStartedEventDataSchema>;

/** The developer's answer to one question. */
const langyUserWaitQuestionAnswerSchemaDefinition = z.object({
  question: z.string(),
  selected: z.array(z.string()),
  other: z.string().optional(),
});
export interface LangyUserWaitQuestionAnswerSchema extends Named<
  typeof langyUserWaitQuestionAnswerSchemaDefinition
> {}
export const langyUserWaitQuestionAnswerSchema: LangyUserWaitQuestionAnswerSchema =
  langyUserWaitQuestionAnswerSchemaDefinition;

/** Where an answer came from. Absent reads as the card in the panel. */
export const langyPermissionAnswerSources = ["panel", "terminal"] as const;
export type LangyPermissionAnswerSource = (typeof langyPermissionAnswerSources)[number];

/**
 * UserWaitEnded — the wait reached its one terminal: decision (permission)
 * or choices (question). `source` says card vs terminal — first answer wins.
 */
const langyUserWaitEndedEventDataSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  waitId: z.string(),
  kind: z.enum(["permission", "question"]),
  toolCallId: z.string().optional(),
  outcome: z.enum(["answered", "expired", "cancelled"]),
  /** Who answered. Absent when the wait expired or was cancelled. */
  userId: z.string().optional(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]).optional(),
  /** Where the answer was given. Absent means the card in the panel. */
  source: z.enum(langyPermissionAnswerSources).optional(),
  answers: z.array(langyUserWaitQuestionAnswerSchema).optional(),
});
export interface LangyUserWaitEndedEventDataSchema extends Named<
  typeof langyUserWaitEndedEventDataSchemaDefinition
> {}
export const langyUserWaitEndedEventDataSchema: LangyUserWaitEndedEventDataSchema =
  langyUserWaitEndedEventDataSchemaDefinition;
export type LangyUserWaitEndedEventData = z.infer<typeof langyUserWaitEndedEventDataSchema>;
