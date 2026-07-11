import { on } from "node:events";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import type {
  ConversationDetail,
  ConversationListItem,
} from "~/server/app-layer/langy/langy-conversation.service";
import { isLangyConversationUpdateVisibleToUser } from "~/server/app-layer/langy/langyConversationUpdateVisibility";
import { trackServerEvent } from "~/server/posthog";
import { checkProjectPermission, isDemoProjectId } from "../rbac";
import {
  langyConversationDetailSchema,
  langyConversationListItemSchema,
  langyMessageSchema,
  langyMessageRoleSchema,
  langyConversationStatusSchema,
  type LangyConversationDetailDto,
  type LangyConversationListItemDto,
  type LangyMessageDto,
} from "./langy.schemas";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";

/**
 * Read-side tRPC router for Langy conversations (ADR-046 frontend).
 *
 * Mirrors `tracesV2` exactly: a SLIM `list` reading only the conversation
 * spine (`langy_conversations` fold projection, no content), a separate
 * on-demand `messages` read for the heavy history (`langy_messages` map
 * projection), a `newCount` the panel polls only when the freshness SSE is
 * disconnected, and a single `onConversationUpdate` subscription that pushes a
 * lightweight per-conversation signal (never row data). All commands
 * (send/rename/share/delete) still flow through the Hono chat + REST surface;
 * this router is read + real-time only.
 *
 * Permission mirrors the Hono read gate (`evaluations:view`).
 */

const LANGY_READ_PERMISSION = "evaluations:view" as const;

/**
 * Every Langy read/command procedure shares one gate: the caller can read the
 * project (`evaluations:view`) AND the project is not the public demo. The demo
 * grants `evaluations:view` to every authenticated user, so the permission check
 * alone would expose the per-user Langy chat that belongs to whoever used Langy
 * there — hence the explicit `isDemoProjectId` refusal, mirroring the Hono
 * `/langy/*` surface. `projectId` lives on the base so procedures declare only
 * their own inputs.
 */
const langyReadProcedure = protectedProcedure
  .input(z.object({ projectId: z.string() }))
  .use(checkProjectPermission(LANGY_READ_PERMISSION))
  .use(async ({ input, next }) => {
    if (isDemoProjectId(input.projectId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Langy is not available on the demo project.",
      });
    }
    return next();
  });

function toListItemDto(item: ConversationListItem): LangyConversationListItemDto {
  return {
    id: item.id,
    title: item.title,
    isShared: item.isShared,
    isOwn: item.isOwn,
    messageCount: item.messageCount,
    lastActivityAtMs: item.lastActivityAt.getTime(),
  };
}

function toDetailDto(detail: ConversationDetail): LangyConversationDetailDto {
  return {
    ...toListItemDto(detail),
    // The fold status is a free string column; narrow to the known set and
    // fall back to "active" for any unexpected value rather than throwing.
    status: langyConversationStatusSchema.catch("active").parse(detail.status),
  };
}

export const langyRouter = createTRPCRouter({
  /**
   * Slim recent-conversations list. Reads only the spine columns; message
   * content is never fetched here. The client pairs this with
   * `keepPreviousData` + `staleTime` so a freshness refetch never blanks the
   * list.
   */
  list: langyReadProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(
      async ({
        input,
        ctx,
      }): Promise<{ items: LangyConversationListItemDto[] }> => {
        const items = await getApp().langy.conversations.getAll({
          projectId: input.projectId,
          userId: ctx.session.user.id,
          limit: input.limit,
        });
        return { items: items.map(toListItemDto) };
      },
    ),

  /**
   * Single-conversation spine (status + counts), for the open conversation.
   * Returns null when the conversation is not visible to the user.
   */
  detail: langyReadProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(
      async ({
        input,
        ctx,
      }): Promise<LangyConversationDetailDto | null> => {
        // A freshness poll of the OPEN conversation — which may be the one the
        // user JUST started, whose fold has not been projected yet. So this is a
        // caller for which absence is a real answer: `findByIdVisible`, not
        // `getById`. Using the throwing form here would 500 the poll on every
        // first turn.
        const detail = await getApp().langy.conversations.findByIdVisible({
          id: input.conversationId,
          projectId: input.projectId,
          userId: ctx.session.user.id,
        });
        return detail ? toDetailDto(detail) : null;
      },
    ),

  /**
   * Heavy on-demand message history for a single conversation. Split from
   * `list` so opening a conversation never re-fetches the slim list, and the
   * list never carries content.
   */
  messages: langyReadProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(
      async ({
        input,
        ctx,
      }): Promise<{
        messages: LangyMessageDto[];
        /**
         * The last turn's failure, serialized (a domain-error kind + safe meta —
         * never raw text). Null unless the conversation ended in one.
         *
         * Turn errors used to live ONLY in the browser's `useChat` state, so a
         * refresh after a failed turn left the user's question sitting there with
         * no answer and no explanation — the failure was real, durable, and on
         * the fold the whole time; nobody read it back.
         */
        lastError: string | null;
      }> => {
        // OWNERSHIP GATE. This query used to check only the PROJECT permission and
        // then read any conversation by id — so any project member could read
        // anyone else's Langy history. Langy conversations are scoped to org +
        // project + USER; `getById` is what enforces that (owner, or explicitly
        // shared) and it THROWS rather than returning an ambiguous null, so the
        // gate cannot be forgotten by a caller who ignores a falsy return.
        const conversation = await getApp().langy.conversations.getById({
          id: input.conversationId,
          projectId: input.projectId,
          userId: ctx.session.user.id,
        });
        const rows = await getApp().langy.messages.getAllByConversation({
          conversationId: input.conversationId,
          projectId: input.projectId,
        });
        const messages = rows.map<LangyMessageDto>((row) => ({
          id: row.id,
          role: langyMessageRoleSchema.catch("assistant").parse(row.role),
          parts: Array.isArray(row.parts)
            ? (row.parts as LangyMessageDto["parts"])
            : [],
          createdAtMs: row.createdAt.getTime(),
        }));
        return {
          messages,
          lastError:
            conversation.status === LANGY_CONVERSATION_STATUS.FAILED
              ? conversation.lastError
              : null,
        };
    }),

  /**
   * Soft-delete (archive) a conversation the current user owns.
   *
   * Routes through the same app-layer command the REST surface uses
   * (`conversations.deleteById`), which dispatches the event-sourced
   * `archiveConversation` command — never a raw row delete. Exposing it here
   * means the whole Langy conversation surface (reads AND this write) goes
   * through this one defined tRPC API instead of ad-hoc client `fetch`es. A
   * non-owner (shared) conversation is visible but not deletable and reports
   * `success: false`; the client invalidates the list either way.
   */
  deleteConversation: langyReadProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ input, ctx }): Promise<{ success: boolean }> => {
      const success = await getApp().langy.conversations.deleteById({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
      });
      return { success };
    }),

  /**
   * Count of conversations touched since a timestamp — the "N new" pill. The
   * client only polls this when the freshness SSE is disconnected (adaptive
   * backoff), mirroring `tracesV2.newCount`. The count derivation lives in the
   * service (`countSince`), not here — transport only shapes input/output.
   */
  newCount: langyReadProcedure
    .input(z.object({ since: z.number() }))
    .query(async ({ input, ctx }): Promise<{ count: number }> => {
      const count = await getApp().langy.conversations.countSince({
        projectId: input.projectId,
        userId: ctx.session.user.id,
        since: input.since,
      });
      return { count };
    }),

  /**
   * In-agent feedback capture ("How's Langy doing?" / thumbs).
   *
   * Two destinations, by design:
   *  - Aggregate product analytics -> PostHog via the backend (never
   *    client-side capture), so it lands in the same pipeline as the rest of
   *    the product.
   *  - The feedback itself (thumbs / frustration) is ALSO meant to flow back
   *    into LangWatch as a feedback event tied to the conversation's trace id,
   *    so we dogfood Langy in our own account. That routing is seamed on
   *    `traceId` below — recording the LangWatch `thumbs_up_down` trace event
   *    against `traceId` (via the events ingestion path) is the follow-up; the
   *    id contract is captured here so the client already sends it.
   *
   * `shareConversationConsent` records that a (possibly frustrated) user
   * granted permission to inspect the full conversation for debugging — the
   * consent flag only; acting on it is a separate, gated flow.
   */
  recordFeedback: langyReadProcedure
    .input(
      z.object({
        conversationId: z.string().optional(),
        messageId: z.string().optional(),
        /** Trace id of the conversation turn, for LangWatch feedback events. */
        traceId: z.string().optional(),
        rating: z.enum(["up", "down"]),
        sentiment: z.enum(["frustrated", "delighted", "neutral"]).optional(),
        comment: z.string().max(2000).optional(),
        shareConversationConsent: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<void> => {
      trackServerEvent({
        userId: ctx.session.user.id,
        event: "langy_feedback",
        projectId: input.projectId,
        properties: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          traceId: input.traceId,
          rating: input.rating,
          sentiment: input.sentiment,
          comment: input.comment,
          shareConversationConsent: input.shareConversationConsent ?? false,
        },
      });
    }),

  /**
   * SSE subscription pushing `langy_conversation_updated` signals to active
   * browsers when a conversation's fold projection advances. The client
   * listens, cancels + invalidates its TanStack cache, and refetches the slim
   * projection — landing fresh data without a data push. Mirrors
   * `traces.onTraceUpdate` / `tracesV2.onDiscoverUpdate` so `useSSESubscription`
   * handles it unchanged.
   */
  onConversationUpdate: langyReadProcedure
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const userId = opts.ctx.session.user.id;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);
      try {
        for await (const eventArgs of on(emitter, "langy_conversation_updated", {
          // @ts-expect-error - signal is not typed on the events overload
          signal: opts.signal,
        })) {
          const data = eventArgs[0] as { event?: unknown; timestamp?: number };
          // User-scope gate: the broadcast is tenant-wide, so drop every signal
          // for a conversation this user cannot access (not owner, not shared),
          // mirroring the read routes' `(UserId = userId OR IsShared)` rule. A
          // non-owner must never even learn that another user's private
          // conversation is active. Fail-closed on any malformed payload.
          if (
            !isLangyConversationUpdateVisibleToUser({
              eventPayload: data.event,
              userId,
            })
          ) {
            continue;
          }
          yield data;
        }
      } finally {
        getApp().broadcast.cleanupTenantEmitter(projectId);
      }
    }),
});
