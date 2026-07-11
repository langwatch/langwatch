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
 * Read gate for every Langy procedure: the caller must be able to read the
 * project AND it must not be the public demo project. `evaluations:view` alone
 * PASSES on the demo for any authenticated user (`DEMO_VIEW_PERMISSIONS`),
 * which would expose whichever user's Langy conversations live there — so
 * refuse the demo explicitly, mirroring the Hono `requireSessionAndPermission`
 * gate. Wraps `checkProjectPermission` so the demo check and the permission
 * check stay in one place across all procedures.
 */
const langyReadGuard = () => {
  const permissionCheck = checkProjectPermission(LANGY_READ_PERMISSION);
  return (opts: Parameters<typeof permissionCheck>[0]) => {
    if (isDemoProjectId(opts.input.projectId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Langy is not available on the demo project.",
      });
    }
    return permissionCheck(opts);
  };
};

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
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .use(langyReadGuard())
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
  detail: protectedProcedure
    .input(z.object({ projectId: z.string(), conversationId: z.string() }))
    .use(langyReadGuard())
    .query(
      async ({
        input,
        ctx,
      }): Promise<LangyConversationDetailDto | null> => {
        const detail = await getApp().langy.conversations.getById({
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
  messages: protectedProcedure
    .input(z.object({ projectId: z.string(), conversationId: z.string() }))
    .use(langyReadGuard())
    .query(async ({ input, ctx }): Promise<{ messages: LangyMessageDto[] }> => {
      // Owner-or-shared gate, mirroring the Hono `GET /langy/conversations/:id`
      // sibling: a project co-member must NOT read the transcript of a private
      // (never-shared) conversation they don't own. `getById` returns null for
      // that case; we surface it as an empty history, not the raw rows and not
      // a 404 (which would leak existence of a known id).
      const conversation = await getApp().langy.conversations.getById({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
      });
      if (!conversation) return { messages: [] };
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
      return { messages };
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
  deleteConversation: protectedProcedure
    .input(z.object({ projectId: z.string(), conversationId: z.string() }))
    .use(langyReadGuard())
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
   * backoff), mirroring `tracesV2.newCount`. Derived from the already-bounded
   * slim list to avoid a second ClickHouse read path.
   */
  newCount: protectedProcedure
    .input(z.object({ projectId: z.string(), since: z.number() }))
    .use(langyReadGuard())
    .query(async ({ input, ctx }): Promise<{ count: number }> => {
      const items = await getApp().langy.conversations.getAll({
        projectId: input.projectId,
        userId: ctx.session.user.id,
        limit: 100,
      });
      const count = items.filter(
        (item) => item.lastActivityAt.getTime() > input.since,
      ).length;
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
  recordFeedback: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
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
    .use(langyReadGuard())
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
  onConversationUpdate: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(langyReadGuard())
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
