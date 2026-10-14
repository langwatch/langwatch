import type { Named } from "@langwatch/module";
import { z } from "zod";

import { LANGY_CONVERSATION_ORIGINS } from "./constants.ts";
import { langyEventCursorSchema } from "./event-sourcing/contracts/cursor.ts";
import { langyConversationTurnEventSchema } from "./event-sourcing/contracts/turn-wire.ts";
import { langyMessageRoleSchema } from "./json.ts";

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
const langyConversationListItemSchemaDefinition = z.object({
  id: z.string(),
  title: z.string().nullable(),
  isShared: z.boolean().default(false),
  isOwn: z.boolean().default(true),
  /** `run` for a conversation a module started for the person, such as a daily insights run. */
  origin: z.enum(LANGY_CONVERSATION_ORIGINS).default("interactive"),
  messageCount: z.number().int().nonnegative().default(0),
  lastActivityAtMs: z.number().default(0),
});
export interface LangyConversationListItemSchema extends Named<
  typeof langyConversationListItemSchemaDefinition
> {}
export const langyConversationListItemSchema: LangyConversationListItemSchema =
  langyConversationListItemSchemaDefinition;
export type LangyConversationListItemDto = z.infer<typeof langyConversationListItemSchema>;

/** Opaque keyset cursor for fetching the next recent-conversations page. */
const langyConversationListCursorSchemaDefinition = z.object({
  lastActivityAtMs: z.number().nullable(),
  id: z.string(),
});
export interface LangyConversationListCursorSchema extends Named<
  typeof langyConversationListCursorSchemaDefinition
> {}
export const langyConversationListCursorSchema: LangyConversationListCursorSchema =
  langyConversationListCursorSchemaDefinition;
export type LangyConversationListCursorDto = z.infer<typeof langyConversationListCursorSchema>;

/** Detail read for an opened conversation. Adds lifecycle status. */
const langyConversationDetailSchemaDefinition = z.object({
  ...langyConversationListItemSchema.shape,
  status: langyConversationStatusSchema.default("active"),
});
export interface LangyConversationDetailSchema extends Named<
  typeof langyConversationDetailSchemaDefinition
> {}
export const langyConversationDetailSchema: LangyConversationDetailSchema =
  langyConversationDetailSchemaDefinition;
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
const langyMessageDtoSchemaDefinition = z.object({
  id: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
  createdAtMs: z.number().default(0),
});
export interface LangyMessageDtoSchema extends Named<typeof langyMessageDtoSchemaDefinition> {}
export const langyMessageDtoSchema: LangyMessageDtoSchema = langyMessageDtoSchemaDefinition;
export type LangyMessageDto = z.infer<typeof langyMessageDtoSchema>;

/**
 * The freshness signal pushed over SSE: OPERATIONAL fields only. Title and
 * message content NEVER ride it — tenant-wide broadcast, owner-private data.
 */
const langyConversationUpdateSignalSchemaDefinition = z.object({
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
export interface LangyConversationUpdateSignalSchema extends Named<
  typeof langyConversationUpdateSignalSchemaDefinition
> {}
export const langyConversationUpdateSignalSchema: LangyConversationUpdateSignalSchema =
  langyConversationUpdateSignalSchemaDefinition;
export type LangyConversationUpdateSignal = z.infer<typeof langyConversationUpdateSignalSchema>;

// ---------------------------------------------------------------------------
// What the `langy.*` tRPC transport answers
// ---------------------------------------------------------------------------

/** `list`: one page of the recent-conversations spine. */
const langyConversationListPageDtoSchemaDefinition = z.object({
  items: z.array(langyConversationListItemSchema),
  nextCursor: langyConversationListCursorSchema.nullable(),
});
export interface LangyConversationListPageDtoSchema extends Named<
  typeof langyConversationListPageDtoSchemaDefinition
> {}
export const langyConversationListPageDtoSchema: LangyConversationListPageDtoSchema =
  langyConversationListPageDtoSchemaDefinition;
export type LangyConversationListPageDto = z.infer<typeof langyConversationListPageDtoSchema>;

/** `conversationEventsAfter`: the durable turn events strictly after a cursor. */
const langyConversationEventPageDtoSchemaDefinition = z.object({
  events: z.array(langyConversationTurnEventSchema),
  cursor: langyEventCursorSchema,
  truncated: z.boolean(),
});
export interface LangyConversationEventPageDtoSchema extends Named<
  typeof langyConversationEventPageDtoSchemaDefinition
> {}
export const langyConversationEventPageDtoSchema: LangyConversationEventPageDtoSchema =
  langyConversationEventPageDtoSchemaDefinition;
export type LangyConversationEventPageDto = z.infer<typeof langyConversationEventPageDtoSchema>;

/**
 * `messages`: the on-demand transcript plus the durable turn state a reopened
 * panel needs — what is in flight, what it ran on, and where the fold is.
 */
const langyConversationMessagesDtoSchemaDefinition = z.object({
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
export interface LangyConversationMessagesDtoSchema extends Named<
  typeof langyConversationMessagesDtoSchemaDefinition
> {}
export const langyConversationMessagesDtoSchema: LangyConversationMessagesDtoSchema =
  langyConversationMessagesDtoSchemaDefinition;
export type LangyConversationMessagesDto = z.infer<typeof langyConversationMessagesDtoSchema>;

/** `deleteConversation`: whether the archive command took effect. */
const langyConversationDeletedSchemaDefinition = z.object({ success: z.boolean() });
export interface LangyConversationDeletedSchema extends Named<
  typeof langyConversationDeletedSchemaDefinition
> {}
export const langyConversationDeletedSchema: LangyConversationDeletedSchema =
  langyConversationDeletedSchemaDefinition;

/** `createConversation` / `continueConversation`: the ids the client subscribes with. */
const langyTurnStartedSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});
export interface LangyTurnStartedSchema extends Named<typeof langyTurnStartedSchemaDefinition> {}
export const langyTurnStartedSchema: LangyTurnStartedSchema = langyTurnStartedSchemaDefinition;

/** `stopTurn`: the durable stop was recorded. */
const langyTurnStoppedSchemaDefinition = z.object({ stopped: z.boolean() });
export interface LangyTurnStoppedSchema extends Named<typeof langyTurnStoppedSchemaDefinition> {}
export const langyTurnStoppedSchema: LangyTurnStoppedSchema = langyTurnStoppedSchemaDefinition;

/** `claimUiAction`: whether THIS tab won the claim. */
const langyUiActionClaimedSchemaDefinition = z.object({ isClaimed: z.boolean() });
export interface LangyUiActionClaimedSchema extends Named<
  typeof langyUiActionClaimedSchemaDefinition
> {}
export const langyUiActionClaimedSchema: LangyUiActionClaimedSchema =
  langyUiActionClaimedSchemaDefinition;

/** `completeUiAction`: whether the completion was taken. */
const langyUiActionCompletedSchemaDefinition = z.object({ isAccepted: z.boolean() });
export interface LangyUiActionCompletedSchema extends Named<
  typeof langyUiActionCompletedSchemaDefinition
> {}
export const langyUiActionCompletedSchema: LangyUiActionCompletedSchema =
  langyUiActionCompletedSchemaDefinition;

/** `warmWorker`: the id the first message should adopt, and whether a worker is warm. */
const langyWarmedWorkerSchemaDefinition = z.object({
  conversationId: z.string().nullable(),
  warmed: z.boolean(),
});
export interface LangyWarmedWorkerSchema extends Named<typeof langyWarmedWorkerSchemaDefinition> {}
export const langyWarmedWorkerSchema: LangyWarmedWorkerSchema = langyWarmedWorkerSchemaDefinition;

/** `modelsAllowed`: the composer's allowlist, or null when every model is allowed. */
const langyModelsAllowedSchemaDefinition = z.object({
  modelsAllowed: z.array(z.string()).nullable(),
});
export interface LangyModelsAllowedSchema extends Named<
  typeof langyModelsAllowedSchemaDefinition
> {}
export const langyModelsAllowedSchema: LangyModelsAllowedSchema =
  langyModelsAllowedSchemaDefinition;

/** `onConversationUpdate`: one freshness signal as the browser receives it. */
const langyConversationUpdateFrameSchemaDefinition = z.object({
  event: z.unknown(),
  timestamp: z.number().optional(),
});
export interface LangyConversationUpdateFrameSchema extends Named<
  typeof langyConversationUpdateFrameSchemaDefinition
> {}
export const langyConversationUpdateFrameSchema: LangyConversationUpdateFrameSchema =
  langyConversationUpdateFrameSchemaDefinition;
