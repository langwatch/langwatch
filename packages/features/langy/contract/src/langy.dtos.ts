import { z } from "zod";
import { langyEventCursorSchema } from "./event-sourcing/contracts/cursor";
import { langyConversationTurnEventSchema } from "./event-sourcing/contracts/turn-wire";
import { langyMessageRoleSchema } from "./json";

/**
 * Slim, per-use-case DTOs for the Langy read surface. Wide-defaulted so an
 * older cached response never throws. Epoch-ms numbers, not `Date`.
 */

export const langyConversationStatusSchema = z.enum([
  "active",
  "running",
  "idle",
  "failed",
  "archived",
]);
export type LangyConversationStatus = z.infer<typeof langyConversationStatusSchema>;

/** The slim spine row the recent-chats list renders. No message content. */
export const langyConversationListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  isShared: z.boolean().default(false),
  isOwn: z.boolean().default(true),
  messageCount: z.number().int().nonnegative().default(0),
  lastActivityAtMs: z.number().default(0),
});
export type LangyConversationListItemDto = z.infer<typeof langyConversationListItemSchema>;

/** Opaque keyset cursor for fetching the next recent-conversations page. */
export const langyConversationListCursorSchema = z.object({
  lastActivityAtMs: z.number().nullable(),
  id: z.string(),
});
export type LangyConversationListCursorDto = z.infer<typeof langyConversationListCursorSchema>;

/** Detail read for an opened conversation. Adds lifecycle status. */
export const langyConversationDetailSchema = langyConversationListItemSchema.extend({
  status: langyConversationStatusSchema.default("active"),
});
export type LangyConversationDetailDto = z.infer<typeof langyConversationDetailSchema>;

/**
 * The role a transcript row carries on the wire — the portable message role,
 * named for the DTO that reads it so the client keeps one import surface.
 */
export type LangyMessageDtoRole = z.infer<typeof langyMessageRoleSchema>;

/**
 * One message row from the on-demand history read. `parts` is the opaque
 * Vercel-AI part array stored verbatim by the map projection; the client
 * narrows it when rendering.
 */
export const langyMessageDtoSchema = z.object({
  id: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
  createdAtMs: z.number().default(0),
});
export type LangyMessageDto = z.infer<typeof langyMessageDtoSchema>;

/**
 * The freshness signal pushed over SSE: OPERATIONAL fields only. Title and
 * message content NEVER ride it — tenant-wide broadcast, owner-private data.
 */
export const langyConversationUpdateSignalSchema = z.object({
  event: z.literal("langy_conversation_updated"),
  conversationId: z.string(),
  status: langyConversationStatusSchema.optional(),
  messageCount: z.number().int().nonnegative().optional(),
  lastActivityAtMs: z.number().nullable().optional(),
  isRunning: z.boolean().optional(),
  /** Boolean-only hint the title changed — text never rides the tenant-wide wire. */
  titleChanged: z.boolean().optional(),
  /**
   * The projection's position when published (ADR-059): fetch the event
   * tail only when the local fold's cursor is behind. Optional for older
   * server builds.
   */
  cursor: z
    .object({
      acceptedAt: z.number().int().nonnegative(),
      eventId: z.string(),
    })
    .optional(),
});
export type LangyConversationUpdateSignal = z.infer<typeof langyConversationUpdateSignalSchema>;

// ---------------------------------------------------------------------------
// What the `langy.*` tRPC transport answers
// ---------------------------------------------------------------------------

/** `list`: one page of the recent-conversations spine. */
export const langyConversationListPageDtoSchema = z.object({
  items: z.array(langyConversationListItemSchema),
  nextCursor: langyConversationListCursorSchema.nullable(),
});
export type LangyConversationListPageDto = z.infer<typeof langyConversationListPageDtoSchema>;

/** `conversationEventsAfter`: the durable turn events strictly after a cursor. */
export const langyConversationEventPageDtoSchema = z.object({
  events: z.array(langyConversationTurnEventSchema),
  cursor: langyEventCursorSchema,
  truncated: z.boolean(),
});
export type LangyConversationEventPageDto = z.infer<typeof langyConversationEventPageDtoSchema>;

/**
 * `messages`: the on-demand transcript plus the durable turn state a reopened
 * panel needs — what is in flight, what it ran on, and where the fold is.
 */
export const langyConversationMessagesDtoSchema = z.object({
  messages: z.array(langyMessageDtoSchema),
  /**
   * The last turn's failure, serialized (a domain-error kind + safe meta — never raw text).
   * Null unless the conversation ended in one.
   */
  lastError: z.string().nullable(),
  /**
   * Whether a turn is in flight RIGHT NOW, read off the fold, independent of any browser
   * stream.
   */
  isTurnInFlight: z.boolean(),
  /**
   * WHICH turn is in flight — null when none is, and null in the brief window between a
   * message being sent and its turn being accepted on the record.
   */
  inFlightTurnId: z.string().nullable(),
  /**
   * Whether the panel should ask "How did Langy do?" under the latest answer — the backend-
   * driven cadence (never a client heuristic; see specs/langy/langy-feedback.feature).
   */
  shouldAskFeedback: z.boolean(),
  /**
   * The projection's event cursor at this snapshot (ADR-059): the client seeds
   * its local fold here and catches up by fetching `conversationEventsAfter`.
   */
  eventCursor: langyEventCursorSchema.nullable(),
  /** The turn in flight, or null — what a refresh reattaches to. */
  currentTurnId: z.string().nullable(),
  /**
   * The model the latest accepted turn ran on, or null before any turn recorded one.
   */
  lastModel: z.string().nullable(),
});
export type LangyConversationMessagesDto = z.infer<typeof langyConversationMessagesDtoSchema>;

/** `deleteConversation`: whether the archive command took effect. */
export const langyConversationDeletedSchema = z.object({ success: z.boolean() });

/** `createConversation` / `continueConversation`: the ids the client subscribes with. */
export const langyTurnStartedSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});

/** `stopTurn`: the durable stop was recorded. */
export const langyTurnStoppedSchema = z.object({ stopped: z.boolean() });

/** `claimUiAction`: whether THIS tab won the claim. */
export const langyUiActionClaimedSchema = z.object({ isClaimed: z.boolean() });

/** `completeUiAction`: whether the completion was taken. */
export const langyUiActionCompletedSchema = z.object({ isAccepted: z.boolean() });

/** `warmWorker`: the id the first message should adopt, and whether a worker is warm. */
export const langyWarmedWorkerSchema = z.object({
  conversationId: z.string().nullable(),
  warmed: z.boolean(),
});

/** `modelsAllowed`: the composer's allowlist, or null when every model is allowed. */
export const langyModelsAllowedSchema = z.object({
  modelsAllowed: z.array(z.string()).nullable(),
});

/** `onConversationUpdate`: one freshness signal as the browser receives it. */
export const langyConversationUpdateFrameSchema = z.object({
  event: z.unknown(),
  timestamp: z.number().optional(),
});
