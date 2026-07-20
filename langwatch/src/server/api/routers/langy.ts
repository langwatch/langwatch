import { on } from "node:events";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { AGENT_CHAT_TIMEOUT_MS } from "~/server/app-layer/langy/execution/langy-turn-errors";
import type {
  ConversationDetail,
  ConversationListItem,
} from "~/server/app-layer/langy/langy-conversation.service";
import type { LangyChatMessageInput } from "~/server/app-layer/langy/langy-turn.service";
import { isLangyConversationUpdateVisibleToUser } from "~/server/app-layer/langy/langyConversationUpdateVisibility";
import {
  type LangyTurnContext,
  langyTurnContextSchema,
} from "~/server/app-layer/langy/langyTurnContext.schema";
import { createLangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { createLangyTurnAccessStore } from "~/server/app-layer/langy/streaming/langyTurnAccess";
import type { Session } from "~/server/auth";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";
import { trackServerEvent } from "~/server/posthog";
import { connection } from "~/server/redis";
import { checkProjectPermission, isDemoProjectId } from "../rbac";
import { enforceLangyAccess } from "./langyAccessMiddleware";
import {
  type LangyConversationDetailDto,
  type LangyConversationListCursorDto,
  type LangyConversationListItemDto,
  type LangyMessageDto,
  langyConversationDetailSchema,
  langyConversationListCursorSchema,
  langyConversationListItemSchema,
  langyConversationStatusSchema,
  langyMessageRoleSchema,
  langyMessageSchema,
} from "./langy.schemas";

/**
 * Read-side tRPC router for Langy conversations (ADR-046 frontend).
 *
 * Mirrors `tracesV2` for reads: a SLIM `list` reading only the Postgres
 * conversation projection (no content), a separate on-demand `messages` read
 * for the heavy Postgres message history, a `newCount` the panel polls only
 * when the freshness SSE is disconnected, and a single `onConversationUpdate`
 * subscription that pushes a lightweight per-conversation signal (never row
 * data). It also owns the turn-start mutations (`createConversation` /
 * `continueConversation`) and the conversation commands (rename/fork/delete):
 * the whole Langy surface is this tRPC router plus the live `onTurnStream`
 * subscription — the old Hono `/api/langy/chat` fallback has been removed.
 *
 * Every procedure derives from `langyReadProcedure` (or `langyTurnProcedure`),
 * so they all share the project read permission (`evaluations:view`), the demo
 * refusal, and the authoritative internal-only gate (`enforceLangyAccess`).
 */

const LANGY_READ_PERMISSION = "evaluations:view" as const;

/**
 * Every Langy read/command procedure shares one base with three gates, in
 * order:
 *  1. `checkProjectPermission(evaluations:view)` — can the caller read the
 *     project at all?
 *  2. demo refusal — the demo project grants `evaluations:view` to every
 *     authenticated user, so the permission check alone would expose the
 *     per-user Langy chat that belongs to whoever used Langy there; refuse it
 *     explicitly.
 *  3. `enforceLangyAccess` — the authoritative internal-only rollout gate
 *     (staff bypass, else `release_langy_enabled`), the SAME decision the
 *     `langyGithub` / `langyEgress` routers and the GitHub install route use.
 *
 * `projectId` lives on the base so procedures declare only their own inputs.
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
  })
  .use(enforceLangyAccess);

/**
 * The turn-start procedure: the read gate PLUS the Phase-1 per-user message
 * rate limit that used to live in the Hono `/langy/chat` handler. Redis-backed;
 * fails open when Redis is down (dev/test stay usable). A limited caller is
 * refused BEFORE reaching the app layer, so it never mints keys or dispatches a
 * turn — exactly the precedence the route enforced.
 */
const langyTurnProcedure = langyReadProcedure.use(
  async ({ ctx, input, next }) => {
    const rl = await checkLangyMessageRateLimit({
      userId: ctx.session.user.id,
      projectId: (input as { projectId: string }).projectId,
    });
    if (!rl.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many messages. Please slow down.",
      });
    }
    return next();
  },
);

/** One chat message on the wire — role + opaque parts (bounded downstream). */
const langyTurnMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
});

/**
 * Per-send model override from the sidebar picker. Shape-validated here;
 * the value is checked against the project's Langy VK allowlist in the service.
 */
const langyModelOverrideSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/,
    "modelOverride must be in 'provider/model' shape",
  )
  .max(200);

/** Inputs shared by create + continue (the SAME turn-start operation). */
const langyTurnInputShape = {
  requestId: z.string().uuid(),
  messages: z.array(langyTurnMessageSchema).min(1),
  modelOverride: langyModelOverrideSchema.optional(),
  /**
   * Why the client is sending. `regenerate-message` RE-DRIVES the last turn
   * against the message already on record (so it is NOT re-posted).
   */
  trigger: z
    .enum(["submit-message", "regenerate-message", "resume-stream"])
    .optional(),
  // Composer context chips (page context + skills) — bounded + sanitised in
  // renderLangyTurnContext; refs are never resolved by the control plane.
  ...langyTurnContextSchema.shape,
} as const;

function toListItemDto(
  item: ConversationListItem,
): LangyConversationListItemDto {
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

/**
 * May this user watch this turn's live stream? Same gate the deleted Hono
 * `/stream` route used: the fast path confirms the turn's own actor from the
 * synchronously-written turn-access record (so a just-started turn doesn't 404
 * before its fold is projected); otherwise it falls back to the durable
 * visibility rule (owner or shared). It never widens access.
 */
async function canWatchTurn({
  projectId,
  conversationId,
  turnId,
  userId,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
}): Promise<boolean> {
  if (connection) {
    const access = createLangyTurnAccessStore({ redis: connection });
    if (
      await access.isTurnActor({ projectId, conversationId, turnId, userId })
    ) {
      return true;
    }
  }
  const conv = await getApp().langy.conversations.findByIdVisible({
    id: conversationId,
    projectId,
    userId,
  });
  return !!conv;
}

/**
 * Dispatch a turn through the app-layer turn service. Create and Continue are
 * the SAME operation — `isNewConversation` is the only difference (it emits the
 * semantically-first `conversation_started`). The service throws DomainErrors,
 * which the shared `domainErrorMiddleware` maps to coded TRPCErrors carrying
 * `data.domainError` (read by the client's `readLangyTrpcError`).
 */
async function acceptTurn({
  input,
  session,
}: {
  input: {
    projectId: string;
    requestId: string;
    conversationId?: string | null;
    messages: LangyChatMessageInput[];
    modelOverride?: string;
    trigger?: "submit-message" | "regenerate-message" | "resume-stream";
    pageContext?: LangyTurnContext["pageContext"];
    skills?: LangyTurnContext["skills"];
  };
  session: Session;
}): Promise<{ conversationId: string; turnId: string }> {
  return getApp().langy.turns.startConversationTurn({
    projectId: input.projectId,
    requestId: input.requestId,
    session,
    requestedConversationId: input.conversationId ?? null,
    messages: input.messages,
    ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
    isRetry: input.trigger === "regenerate-message",
    turnContext: { pageContext: input.pageContext, skills: input.skills },
  });
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
        limit: z.number().int().min(1).max(100).default(30),
        cursor: langyConversationListCursorSchema.optional(),
        query: z.string().trim().max(200).optional(),
      }),
    )
    .query(
      async ({
        input,
        ctx,
      }): Promise<{
        items: LangyConversationListItemDto[];
        nextCursor: LangyConversationListCursorDto | null;
      }> => {
        const page = await getApp().langy.conversations.getPage({
          projectId: input.projectId,
          userId: ctx.session.user.id,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.query ? { query: input.query } : {}),
        });
        return {
          items: page.items.map(toListItemDto),
          nextCursor: page.nextCursor,
        };
      },
    ),

  /**
   * Single-conversation spine (status + counts), for the open conversation.
   * Returns null when the conversation is not visible to the user.
   */
  detail: langyReadProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(
      async ({ input, ctx }): Promise<LangyConversationDetailDto | null> => {
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
        /**
         * Whether a turn is in flight RIGHT NOW, read off the fold, independent
         * of any browser stream. "In flight" is the whole span from the moment
         * the message is sent (`active`) through the agent responding
         * (`running`) — deliberately NOT just `running`, because the fold only
         * reaches `running` at `agent_turn_accepted`, i.e. AFTER the worker
         * has cold-started (fork opencode, lay out the home, npm-install skills —
         * minutes on a cold worker). That warm-up is exactly the window the UI
         * must not go blank in, and there the status is still `active`.
         *
         * The client's live transport (`useChat`) only knows a turn is running
         * while its `onTurnStream` subscription is open — and that closes the
         * instant a silent worker stops pushing frames, long before the turn is
         * over (the liveness subscriber keeps re-driving for its whole grace
         * budget). The Postgres operational projection is the durable read
         * model: it stays
         * `active`/`running` until the turn finalizes (`idle`) or fails
         * (`failed`), so the panel can hold a working state the whole time and
         * never leave the user staring at just their own message.
         */
        isTurnInFlight: boolean;
      }> => {
        // Both reads go through user-scoped application services. The message
        // service performs its own visibility check; this detail read is also
        // needed for the durable turn status returned alongside the transcript.
        const conversation = await getApp().langy.conversations.getById({
          id: input.conversationId,
          projectId: input.projectId,
          userId: ctx.session.user.id,
        });
        const rows = await getApp().langy.messages.getAllByConversation({
          conversationId: input.conversationId,
          projectId: input.projectId,
          userId: ctx.session.user.id,
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
          isTurnInFlight:
            conversation.status === LANGY_CONVERSATION_STATUS.ACTIVE ||
            conversation.status === LANGY_CONVERSATION_STATUS.RUNNING,
        };
      },
    ),

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

  /** Rename a conversation the caller owns through the event-sourced service. */
  renameConversation: langyReadProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<LangyConversationDetailDto> => {
      const detail = await getApp().langy.conversations.updateById({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
        title: input.title,
      });
      if (!detail) throw new TRPCError({ code: "NOT_FOUND" });
      return toDetailDto(detail);
    }),

  /** Branch a visible conversation into a private, independently editable one. */
  forkConversation: langyReadProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }): Promise<LangyConversationDetailDto> => {
      const { conversation } = await getApp().langy.conversations.forkById({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
      });
      return toDetailDto(conversation);
    }),

  /**
   * Start the FIRST turn of a NEW conversation. Mints a fresh conversation id,
   * emits the semantically-first `conversation_started`, then dispatches the
   * turn. Returns the ids the client subscribes to `onTurnStream` with.
   *
   * This is the tRPC replacement for `POST /api/langy/chat` on the create path.
   * The Phase-1 gate (session + demo refusal + `evaluations:view` + rate limit)
   * is the `langyTurnProcedure`; the turn service throws DomainErrors that the
   * shared middleware maps to coded TRPCErrors.
   */
  createConversation: langyTurnProcedure
    .input(z.object(langyTurnInputShape))
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{ conversationId: string; turnId: string }> => {
        return acceptTurn({
          input: {
            ...input,
            messages: input.messages as LangyChatMessageInput[],
          },
          session: ctx.session,
        });
      },
    ),

  /**
   * Continue an EXISTING conversation (same operation as create, minus the
   * first-message marker). Requires the conversation id; ownership is enforced
   * in the service (`ensureConversation`), which throws
   * `LangyConversationNotOwnedError` for someone else's conversation.
   */
  continueConversation: langyTurnProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
        ...langyTurnInputShape,
      }),
    )
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{ conversationId: string; turnId: string }> => {
        return acceptTurn({
          input: {
            ...input,
            messages: input.messages as LangyChatMessageInput[],
          },
          session: ctx.session,
        });
      },
    ),

  /**
   * Count of conversations touched since a timestamp — the "N new" pill. The
   * client only polls this when the freshness SSE is disconnected (adaptive
   * backoff), mirroring `tracesV2.newCount`. The count derivation lives in the
   * service (`countSince`), not here — transport only shapes input/output.
   */
  /**
   * The model allowlist the composer's picker narrows to, or null when the
   * project's Langy VK sets none (every eligible model is allowed).
   *
   * Served here rather than read off `virtualKeys.list`: that listing no
   * longer returns product-managed keys, and the picker only ever wanted this
   * one field — so the client has no reason to receive a virtual-key row at
   * all.
   */
  modelsAllowed: langyReadProcedure.query(
    async ({ input }): Promise<{ modelsAllowed: string[] | null }> => {
      const modelsAllowed =
        await getApp().langy.credentials.getModelsAllowedForProject(
          input.projectId,
        );
      return { modelsAllowed };
    },
  ),

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
  onConversationUpdate: langyReadProcedure.subscription(async function* (opts) {
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

  /**
   * The live turn stream. Yields the durable token-buffer entries for one turn
   * (delta / tool / status / progress / milestone / end / error) as an ordered
   * async generator — the tRPC replacement for the deleted Hono `/chat` +
   * `/stream` UIMessage SSE. Reads the SAME durable buffer `attachTurnStream`
   * did (tail-then-follow on one Redis Stream), so a (re)connect gets the
   * buffered prefix then the live edge, gap-free.
   *
   * Ephemeral by contract: the buffer is best-effort live delivery; the durable
   * TRUTH is the fold, loaded by the `messages` query on turn end (the client's
   * reconcile). This carries only live chunks, never the authoritative snapshot.
   */
  onTurnStream: langyReadProcedure
    .input(z.object({ conversationId: z.string(), turnId: z.string() }))
    // The yield type is inferred from the buffer's `LangyStreamEntry` entries, so no
    // explicit `: AsyncGenerator<…>` return annotation is needed. On an input-bearing
    // subscription tRPC v10 doesn't type `opts.signal` (same as the traces/presence
    // routers), so it's suppressed where it's read below.
    .subscription(async function* (opts) {
      const { projectId, conversationId, turnId } = opts.input;
      const userId = opts.ctx.session.user.id;

      // Same gate the deleted `/stream` route used. Reported as not-found so it
      // can't be used to probe another user's private conversation.
      if (
        !(await canWatchTurn({ projectId, conversationId, turnId, userId }))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Turn not found." });
      }
      // No Redis ⇒ no live buffer; the client falls back to the Postgres
      // conversation/message query.
      if (!connection) return;

      const blocking = connection.duplicate();
      const buffer = createLangyTokenBuffer({
        redis: connection,
        blockingRedis: blocking,
      });
      // Tear down on client disconnect OR the hard per-turn deadline, whichever
      // comes first — a wedged turn must not hold a blocking connection forever.
      const signals: AbortSignal[] = [
        AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS),
      ];
      // @ts-expect-error - signal is not typed
      if (opts.signal) signals.push(opts.signal);
      const signal = AbortSignal.any(signals);

      try {
        // Drain the buffered prefix, then tail the live edge from where it ended.
        const { reads, lastId } = await buffer.readTail({
          conversationId,
          turnId,
        });
        let terminal = false;
        for (const { entry } of reads) {
          yield entry;
          if (entry.type === "end" || entry.type === "error") terminal = true;
        }
        if (!terminal) {
          for await (const { entry } of buffer.follow({
            conversationId,
            turnId,
            fromId: lastId,
            signal,
          })) {
            yield entry;
            if (entry.type === "end" || entry.type === "error") break;
          }
        }
      } finally {
        blocking.disconnect();
      }
    }),
});
