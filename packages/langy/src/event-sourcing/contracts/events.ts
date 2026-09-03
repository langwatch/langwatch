/**
 * Event PAYLOAD schemas for the `langy_conversation` aggregate (ADR-046) — the
 * `data` half of every durable event, shared by the server pipeline (which
 * wraps them in its own branded event envelope) and the browser (which folds
 * them locally, ADR-059). Payloads are pure Zod: no server types, no branding.
 *
 * The full event schemas — envelope + `type`/`version` literals — stay in the
 * server pipeline (`langy-conversation-processing/schemas/events.ts`): the
 * envelope carries server-domain branding (TenantId, AggregateType) that has
 * no business in a browser bundle.
 */
import { z } from "zod";

import {
  langyJsonValueSchema,
  langyMessagePartSchema,
  langyMessageRoleSchema,
} from "../../json";

/**
 * ConversationStarted — an explicit conversation-creation event. Sets the owner
 * (first-writer-wins) and, optionally, an initial title, BEFORE any message.
 * Distinct from `message_recorded` (which also lazily creates on the fold
 * for robustness): a `create → then message` flow emits this first, so an empty
 * conversation can exist. Feeds the conversation spine fold only — no message
 * row, no turn document (it is not turn-scoped).
 */
export const langyConversationStartedEventDataSchema = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set once (first-writer-wins). */
  userId: z.string(),
  /** Optional initial title (else derived from the first message). */
  title: z.string().nullable().optional(),
  /**
   * The per-conversation `runToken` (see `streaming/langyFrameAuth.ts`): a 32-byte
   * CSPRNG secret (hex) minted here, injected into the worker at spawn, and used
   * to HMAC every frame the worker streams back. SERVER-ONLY — it is folded into
   * a server-only state column (never a client-facing projection or the turn
   * render doc) and never re-sent on the wire. Nullable/optional so events
   * predating this field, and lazily-created conversations, still replay.
   */
  runToken: z.string().nullable().optional(),
});
export type LangyConversationStartedEventData = z.infer<
  typeof langyConversationStartedEventDataSchema
>;

/**
 * ConversationForked — a fresh user-owned aggregate branched from a visible
 * conversation. The source id is durable lineage in the event log; imported
 * transcript rows arrive as explicit `message_imported` events so a replay can
 * rebuild the new conversation without reading the source projection again.
 */
export const langyConversationForkedEventDataSchema = z.object({
  conversationId: z.string(),
  sourceConversationId: z.string(),
  userId: z.string(),
  title: z.string().nullable(),
  runToken: z.string(),
});
export type LangyConversationForkedEventData = z.infer<
  typeof langyConversationForkedEventDataSchema
>;

/**
 * MessageRecorded — a user (or system) message was added to the
 * conversation. Feeds both operational conversation state (owner, title,
 * activity, count) and the message projection. `parts` is opaque to the pipeline.
 */
export const langyMessageRecordedEventDataSchema = z.object({
  conversationId: z.string(),
  /** Owner of the conversation. Set from the first message only. */
  userId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
  /** Derived from the first user message; operational state keeps the first non-empty. */
  title: z.string().nullable().optional(),
});
export type LangyMessageRecordedEventData = z.infer<
  typeof langyMessageRecordedEventDataSchema
>;

/**
 * MessageImported — one immutable message copied into a fork. It is distinct
 * from `message_recorded` and `agent_responded`: importing history must
 * not start a turn, trigger title generation, or pretend the agent responded
 * again. New message ids keep the fork independent; source ids preserve audit
 * lineage.
 */
export const langyMessageImportedEventDataSchema = z.object({
  conversationId: z.string(),
  sourceConversationId: z.string(),
  sourceMessageId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(langyMessagePartSchema).default([]),
});
export type LangyMessageImportedEventData = z.infer<
  typeof langyMessageImportedEventDataSchema
>;

/**
 * AgentTurnAccepted — the user's turn was durably admitted for dispatch.
 *
 * `questionParts` carries the user's question that opened this turn, so the
 * per-turn document (langyConversationTurn) is self-contained — question AND
 * answer in one render doc — without a join back to message history. Optional:
 * an accepted turn without a captured question still records.
 *
 * `model` is the provider-prefixed model this turn runs on (the composer's
 * pick, or the resolved default when none). The conversation fold keeps the
 * latest as `LastModel`, so reopening a conversation restores the model it
 * last ran on. Optional: events predating the field still fold.
 */
export const langyAgentTurnAcceptedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  questionParts: z.array(langyMessagePartSchema).optional(),
  model: z.string().optional(),
});
export type LangyAgentTurnAcceptedEventData = z.infer<
  typeof langyAgentTurnAcceptedEventDataSchema
>;

/**
 * ToolCallInitiated — the agent began a tool call during a response. Recorded
 * as a meaningful transition (not a token) and treated as liveness.
 *
 * It carries WHAT THE CALL IS DOING, not merely that one happened. A tool name
 * on its own is close to worthless here: half of Langy's calls are `bash`, and
 * "the agent ran bash" answers nothing you would ever ask of an event log. The
 * command is the identity of the call — the thing you search for, the thing you
 * reproduce, the thing that tells you `bash` was really a trace search.
 *
 * `command` is the shell command when the tool is a shell (the overwhelmingly
 * common case, and the one worth having a first-class field for). `input` keeps
 * the full argument object for every other tool. Both are optional because a
 * frame that never surfaced its arguments must still be recordable — an event we
 * refuse to write is strictly worse than one that is missing a field.
 */
export const langyToolCallInitiatedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
});
export type LangyToolCallInitiatedEventData = z.infer<
  typeof langyToolCallInitiatedEventDataSchema
>;

/**
 * ToolCallSucceeded — a tool call the agent initiated returned without error.
 *
 * Self-describing, exactly like its `initiated` twin: it repeats the `command`
 * so that ONE event answers "what ran, and how long did it take?" without a join
 * back to the start. Debugging a response is reading a list of these, and a list
 * that says only `bash` sends you hunting for the other half.
 *
 * `durationMs` is what turns the log into something you can find a slow call in
 * — the CLI spawn alone has been measured in the hundreds of milliseconds, and
 * you cannot chase that without a number. A tool call that errored is a distinct
 * event (`tool_call_failed`), so no `isError` boolean lives here.
 */
export const langyToolCallSucceededEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
  durationMs: z.number().optional(),
});
export type LangyToolCallSucceededEventData = z.infer<
  typeof langyToolCallSucceededEventDataSchema
>;

/**
 * ToolCallFailed — a tool call the agent initiated returned an error. The
 * failing twin of `tool_call_succeeded`: a call reaches exactly one of the two.
 *
 * `errorText` keeps the failure itself, truncated, rather than a bare boolean
 * that tells you a thing broke but not why — the whole reason a failed call is
 * its own event is that the failure detail is worth first-class carriage.
 */
export const langyToolCallFailedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: langyJsonValueSchema.optional(),
  durationMs: z.number().optional(),
  errorText: z.string().optional(),
});
export type LangyToolCallFailedEventData = z.infer<
  typeof langyToolCallFailedEventDataSchema
>;

/**
 * PlanUpdated — a full snapshot of the agent's plan (its `todowrite` todo list)
 * during a turn. Snapshot-typed: `todowrite` rewrites the whole list per call, so
 * each event carries the entire list and the fold applies last-write-wins (by
 * occurredAt). One "meaningful transition" per todowrite call — the plan the
 * panel mirrors as a live checklist, now durable so the checklist survives a
 * reload from the fold. `status` is a permissive string (the client tolerates an
 * unknown value as pending), and `items` is capped/truncated at the manager.
 */
export const langyPlanItemSchema = z
  .record(z.string(), langyJsonValueSchema)
  .and(
    z.object({
      content: z.string(),
      status: z.string(),
    }),
  );
export type LangyPlanItemData = z.infer<typeof langyPlanItemSchema>;

export const langyPlanUpdatedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  items: z.array(langyPlanItemSchema).default([]),
});
export type LangyPlanUpdatedEventData = z.infer<
  typeof langyPlanUpdatedEventDataSchema
>;

/**
 * AgentResponseFailed — the response's lifecycle failed with no answer to carry
 * (a stalled/orphaned response the liveness sweep terminalizes). Distinct from
 * `agent_responded`, which carries the completed answer.
 */
export const langyAgentResponseFailedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  error: z.string(),
});
export type LangyAgentResponseFailedEventData = z.infer<
  typeof langyAgentResponseFailedEventDataSchema
>;

/**
 * AgentResponded — the whole final answer of an agent response, the source of
 * truth. Streamed tokens are NOT events; this single event carries the complete
 * assistant message. Feeds operational state (terminal status, count) and the
 * assistant message projection.
 *
 * `outcome` is the terminal discriminant on the ONE answer-carrying terminal:
 * `completed` (the agent finished), `failed` (it ran but ended in failure, still
 * with something to carry — distinct from `agent_response_failed`, which is the
 * no-answer stall), and `stopped` (the USER stopped the turn mid-answer, ADR-078).
 * A stop is not a failure and carries the partial answer streamed so far, so it
 * rides this event and its `turn-terminal` idempotency slot rather than inventing
 * a parallel terminal.
 */
export const langyAgentRespondedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  messageId: z.string(),
  role: langyMessageRoleSchema.default("assistant"),
  parts: z.array(langyMessagePartSchema).default([]),
  outcome: z.enum(["completed", "failed", "stopped"]).default("completed"),
  error: z.string().nullable().optional(),
});
export type LangyAgentRespondedEventData = z.infer<
  typeof langyAgentRespondedEventDataSchema
>;

/**
 * ConversationArchived — soft-delete. Flips the fold's status/ArchivedAt.
 * No ClickHouse hard-deletion (ADR-046, out of scope).
 */
export const langyConversationArchivedEventDataSchema = z.object({
  conversationId: z.string(),
});
export type LangyConversationArchivedEventData = z.infer<
  typeof langyConversationArchivedEventDataSchema
>;

/**
 * ConversationMetadataUpdated — rename and/or share toggle. Beyond the
 * prescribed vocabulary; preserves the PATCH route (ADR-046 open question 1).
 * Any field left undefined is unchanged by the fold.
 */
export const langyConversationMetadataUpdatedEventDataSchema = z.object({
  conversationId: z.string(),
  title: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
  sharedById: z.string().nullable().optional(),
});
export type LangyConversationMetadataUpdatedEventData = z.infer<
  typeof langyConversationMetadataUpdatedEventDataSchema
>;

/**
 * ConversationHandoffPending (ADR-048) — a turn checkpointed on pod termination
 * and left an opaque, worker-authored resume token. The fold stores the token
 * (PendingHandoffToken/PendingHandoffTurnId), clears CurrentTurnId (the turn
 * handed off, it did not fail), and returns the conversation to idle. The token
 * is OPAQUE to the pipeline — persisted verbatim, only opencode authors and
 * consumes it.
 */
export const langyConversationHandoffPendingEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  token: z.string(),
});
export type LangyConversationHandoffPendingEventData = z.infer<
  typeof langyConversationHandoffPendingEventDataSchema
>;

/**
 * ConversationHandoffConsumed (ADR-048) — the next turn threaded the pending
 * resume token to a fresh worker and cleared it from the fold. Idempotency on
 * the command collapses a double-consume to a single event.
 */
export const langyConversationHandoffConsumedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});
export type LangyConversationHandoffConsumedEventData = z.infer<
  typeof langyConversationHandoffConsumedEventDataSchema
>;

/**
 * ConversationTitleGenerated — a cheap-model auto title produced after a
 * finalized response by the process-outbox title effect. Updates operational
 * `Title` ONLY when `titleSource !== "user"` (a manual rename is sticky), and
 * marks the title source as `auto`. Carries the model that produced it
 * for provenance. No message row and no activity bump — it refines metadata,
 * it is not conversational activity.
 */
export const langyConversationTitleGeneratedEventDataSchema = z.object({
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
export const langyLocalWorkspaceSchema = z.object({
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
export type LangyLocalWorkspaceData = z.infer<typeof langyLocalWorkspaceSchema>;

/**
 * LocalControlRequested — the code access card asked the developer to share a
 * folder. The request is single use and expires; the command line lists it,
 * approves it and gets a session key bound to this conversation.
 */
export const langyLocalControlRequestedEventDataSchema = z.object({
  conversationId: z.string(),
  requestId: z.string(),
  /** The user who may approve it. Nobody else ever sees it. */
  userId: z.string(),
  /** Unix ms after which the request is refused. */
  expiresAt: z.number(),
  /** The one command the card shows. */
  command: z.string(),
});
export type LangyLocalControlRequestedEventData = z.infer<
  typeof langyLocalControlRequestedEventDataSchema
>;

/** LocalWorkspaceConnected — a folder registered for this conversation. */
export const langyLocalWorkspaceConnectedEventDataSchema = z.object({
  conversationId: z.string(),
  requestId: z.string(),
  userId: z.string(),
  instanceId: z.string(),
  workspace: langyLocalWorkspaceSchema,
});
export type LangyLocalWorkspaceConnectedEventData = z.infer<
  typeof langyLocalWorkspaceConnectedEventDataSchema
>;

/**
 * LocalWorkspaceDisconnected — the folder is gone. `reason` says who ended it,
 * so the card can tell a Ctrl-C from a disconnect the user asked for in the
 * panel, and both from a machine that stopped answering.
 */
export const langyLocalWorkspaceDisconnectedEventDataSchema = z.object({
  conversationId: z.string(),
  instanceId: z.string(),
  reason: z.enum(["cli_exit", "panel", "presence_lost"]),
});
export type LangyLocalWorkspaceDisconnectedEventData = z.infer<
  typeof langyLocalWorkspaceDisconnectedEventDataSchema
>;

/**
 * LocalPolicyChanged — the developer turned the permission checks off, or back
 * on, for this conversation. `userId` is the consent: the choice is a person's,
 * never the model's.
 */
export const langyLocalPolicyChangedEventDataSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
  skipPermissions: z.boolean(),
  /** The model the gate resolved against when the choice was made. */
  model: z.string().optional(),
});
export type LangyLocalPolicyChangedEventData = z.infer<
  typeof langyLocalPolicyChangedEventDataSchema
>;

/** One option on a question card. */
export const langyUserWaitQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

/** One question of a question wait. */
export const langyUserWaitQuestionSchema = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(langyUserWaitQuestionOptionSchema),
  multiple: z.boolean().optional(),
  allowOther: z.boolean().optional(),
});

/** What a permission wait shows on its card. */
export const langyUserWaitPermissionPayloadSchema = z.object({
  callId: z.string(),
  /** The command, as the card prints it. */
  summary: z.string(),
  /** What "allow for this session" would grant. */
  pattern: z.string(),
  /** Why the call is not read-only, in one line. */
  reason: z.string(),
  /** Whether the card may offer the skip toggle at all. */
  skipOffered: z.boolean(),
  /** The folder the command would run in. */
  workspaceName: z.string(),
  hostname: z.string(),
});

/**
 * UserWaitStarted — a tool is waiting for the developer. One primitive behind
 * the permission card and the question card: the durable record is here, and
 * the live stream entry only wakes the panel up.
 */
export const langyUserWaitStartedEventDataSchema = z.object({
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
export type LangyUserWaitStartedEventData = z.infer<
  typeof langyUserWaitStartedEventDataSchema
>;

/** The developer's answer to one question. */
export const langyUserWaitQuestionAnswerSchema = z.object({
  question: z.string(),
  selected: z.array(z.string()),
  other: z.string().optional(),
});

/**
 * UserWaitEnded — the wait reached its one terminal. An answered permission
 * wait carries the decision; an answered question wait carries the choices.
 */
export const langyUserWaitEndedEventDataSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  waitId: z.string(),
  kind: z.enum(["permission", "question"]),
  toolCallId: z.string().optional(),
  outcome: z.enum(["answered", "expired", "cancelled"]),
  /** Who answered. Absent when the wait expired or was cancelled. */
  userId: z.string().optional(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]).optional(),
  answers: z.array(langyUserWaitQuestionAnswerSchema).optional(),
});
export type LangyUserWaitEndedEventData = z.infer<
  typeof langyUserWaitEndedEventDataSchema
>;
