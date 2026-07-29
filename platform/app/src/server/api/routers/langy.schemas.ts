import { z } from "zod";

/**
 * Slim, per-use-case DTOs for the Langy read router.
 *
 * Mirrors `tracesV2.schemas.ts`: one narrow schema per use-case, each with an
 * exported `z.infer` type. Fields are wide-defaulted so an older cached
 * response (or a replayed projection with a missing column) never throws on
 * the client. The list DTO is deliberately narrower than the detail DTO, and
 * neither carries message content — heavy history is a separate on-demand read
 * (`langy.messages`).
 *
 * The wire shape uses epoch-ms numbers (`lastActivityAtMs`), not `Date`, so it
 * survives JSON transport without superjson-specific coupling on the client.
 */

export const langyConversationStatusSchema = z.enum([
  "active",
  "running",
  "idle",
  "failed",
  "archived",
]);
export type LangyConversationStatus = z.infer<
  typeof langyConversationStatusSchema
>;

/** The slim spine row the recent-chats list renders. No message content. */
export const langyConversationListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  isShared: z.boolean().default(false),
  isOwn: z.boolean().default(true),
  messageCount: z.number().int().nonnegative().default(0),
  lastActivityAtMs: z.number().default(0),
});
export type LangyConversationListItemDto = z.infer<
  typeof langyConversationListItemSchema
>;

/** Opaque keyset cursor for fetching the next recent-conversations page. */
export const langyConversationListCursorSchema = z.object({
  lastActivityAtMs: z.number().nullable(),
  id: z.string(),
});
export type LangyConversationListCursorDto = z.infer<
  typeof langyConversationListCursorSchema
>;

/** Detail read for an opened conversation. Adds lifecycle status. */
export const langyConversationDetailSchema =
  langyConversationListItemSchema.extend({
    status: langyConversationStatusSchema.default("active"),
  });
export type LangyConversationDetailDto = z.infer<
  typeof langyConversationDetailSchema
>;

export const langyMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "system",
]);
export type LangyMessageDtoRole = z.infer<typeof langyMessageRoleSchema>;

/**
 * One message row from the on-demand history read. `parts` is the opaque
 * Vercel-AI part array stored verbatim by the map projection; the client
 * narrows it when rendering.
 */
export const langyMessageSchema = z.object({
  id: z.string(),
  role: langyMessageRoleSchema,
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
  createdAtMs: z.number().default(0),
});
export type LangyMessageDto = z.infer<typeof langyMessageSchema>;

/**
 * The freshness signal pushed over SSE.
 *
 * Design note (perceived-latency optimization): rather than a pure id-only
 * "go refetch" signal, this carries the low-sensitivity OPERATIONAL spine
 * (status, counts, activity, running-flag) that the worker reactor already
 * holds in the fold state — so the client applies it in place with
 * `setQueryData` and skips a ClickHouse round-trip. It deliberately omits
 * every content-derived field (title, messages): the broadcast is tenant-wide
 * (all project members) but a Langy conversation is private to its owner, so
 * putting the title on the wire would leak it. The client applies the
 * operational fields only to conversations already in its (server-filtered)
 * list, and falls back to cancel()+invalidate() for unknown ids or a title
 * change — the invalidate re-applies server-side visibility. Best of both:
 * instant for the conversation you're looking at, correct for everything else.
 */
export const langyConversationUpdateSignalSchema = z.object({
  event: z.literal("langy_conversation_updated"),
  conversationId: z.string(),
  status: langyConversationStatusSchema.optional(),
  messageCount: z.number().int().nonnegative().optional(),
  lastActivityAtMs: z.number().nullable().optional(),
  isRunning: z.boolean().optional(),
  /**
   * Boolean-only hint that this conversation's title changed (auto title or a
   * manual rename). The title TEXT is never on the wire — the broadcast is
   * tenant-wide and a conversation is private to its owner — so the client
   * treats this as "go refetch through the visibility gate" rather than a value
   * to apply in place.
   */
  titleChanged: z.boolean().optional(),
  /**
   * The conversation projection's position when this signal was published
   * (ADR-059): compare with the local fold's cursor and fetch the event tail
   * (`conversationEventsAfter`) only when behind. A cursor is inert — the
   * signal still carries no conversation content. Optional so signals from
   * older server builds keep parsing.
   */
  cursor: z
    .object({
      acceptedAt: z.number().int().nonnegative(),
      eventId: z.string(),
    })
    .optional(),
});
export type LangyConversationUpdateSignal = z.infer<
  typeof langyConversationUpdateSignalSchema
>;
