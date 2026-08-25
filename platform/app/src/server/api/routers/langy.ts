// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { on } from "node:events";
import { ValidationError } from "@langwatch/handled-error";
import {
  LANGY_CONVERSATION_STATUS,
  LangyConversationNotFoundError,
  LangyRateLimitedError,
  type LangyConversationDetail as ConversationDetail,
  type LangyConversationListItem as ConversationListItem,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import type { App } from "~/server/app-layer/app";
import {
  AGENT_CHAT_TIMEOUT_MS,
  ADOPTABLE_CONVERSATION_ID,
  LangyTurnAccessStore,
  LangyTokenBuffer,
} from "@langwatch/langy-server";
import type { LangyChatMessageInput } from "~/server/app-layer/langy/langy-turn.service";
import { isLangyConversationUpdateVisibleToUser } from "~/server/app-layer/langy/langyConversationUpdateVisibility";
import {
  type LangyTurnContext,
  langyTurnContextSchema,
} from "~/server/app-layer/langy/langyTurnContext.schema";
import { abortableDelay } from "~/server/app-layer/langy/streaming/awaitTurnSettlement";
import type { LangyStreamEntry } from "@langwatch/langy-server";
import { decideSyntheticTerminal } from "~/server/app-layer/langy/streaming/langyTurnSettlement";
import type { Session } from "~/server/auth";
import {
  checkLangyMessageRateLimit,
  checkLangyWarmRateLimit,
} from "~/server/middleware/rate-limit-langy";
import { trackServerEvent } from "~/server/posthog";
import {
  type LangyConversationDetailDto,
  type LangyConversationListCursorDto,
  type LangyConversationListItemDto,
  type LangyMessageDto,
  langyConversationListCursorSchema,
  langyConversationStatusSchema,
  langyMessageRoleSchema,
} from "./langy.schemas";
import { enforceLangyAccess, refuseDemoProject } from "./langyAccessMiddleware";

const logger = createLogger("langwatch:langy:router");

/**
 * Read-side tRPC router for Langy conversations (ADR-046 frontend).
 *
 * Mirrors `tracesV2` for reads: a SLIM `list` reading only the Postgres
 * conversation projection (no content), a separate on-demand `messages` read
 * for the heavy Postgres message history, and a single `onConversationUpdate`
 * subscription that pushes a lightweight per-conversation signal (never row
 * data). It also owns the turn-start mutations (`createConversation` /
 * `continueConversation`) and the conversation commands (rename/fork/delete):
 * the whole Langy surface is this tRPC router plus the live `onTurnStream`
 * subscription — the old Hono `/api/langy/chat` fallback has been removed.
 *
 * Every procedure derives from one of the `langy*Procedure` bases below, so
 * they all share the demo refusal and the authoritative internal-only gate
 * (`enforceLangyAccess`), and differ only in which `langy:*` permission they
 * demand.
 */

/**
 * Builds a Langy procedure gated on one `langy:*` permission, with three
 * gates in order:
 *  1. `.permission(permission)` — may the caller do THIS to the
 *     project? Reads want `langy:view`; starting a turn wants `langy:create`,
 *     because it provisions credentials, spawns a worker and spends the
 *     project's model budget — not something a read grant should buy.
 *  2. demo refusal — `project:view` is granted to every authenticated user on
 *     the demo project, so a permission check alone would expose whatever
 *     Langy chat someone left there; refuse it explicitly.
 *  3. `enforceLangyAccess` — the authoritative rollout gate, the SAME decision
 *     the `langyEgress` router uses. Last, so membership is always proven
 *     before the flag is read.
 *
 * The permission declaration comes before any `.use()`: `permissionProcedureBuilder`
 * treats that slot specially and injects `enforcePermissionCheck` after it.
 *
 * `projectId` lives on the base so procedures declare only their own inputs.
 */
const langyProcedure = (
  permission: "langy:view" | "langy:create" | "langy:update" | "langy:delete",
) =>
  protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission(permission)
    .use(refuseDemoProject)
    .use(enforceLangyAccess);

const langyReadProcedure = langyProcedure("langy:view");
const langyCreateProcedure = langyProcedure("langy:create");
const langyUpdateProcedure = langyProcedure("langy:update");
const langyDeleteProcedure = langyProcedure("langy:delete");

/**
 * The turn-start procedure: `langy:create` PLUS the Phase-1 per-user message
 * rate limit that used to live in the Hono `/langy/chat` handler. Redis-backed;
 * fails open when Redis is down (dev/test stay usable). A limited caller is
 * refused BEFORE reaching the app layer, so it never mints keys or dispatches a
 * turn — exactly the precedence the route enforced.
 */
const langyTurnProcedure = langyCreateProcedure.use(
  async ({ ctx, input, next }) => {
    const rl = await checkLangyMessageRateLimit({
      userId: ctx.session.user.id,
      projectId: (input as { projectId: string }).projectId,
    });
    if (!rl.allowed) {
      // Typed, not a bare TRPCError: ADR-045 names rate-limited as a handled
      // condition, and only a handled error puts `data.error` on the wire. A
      // raw TRPCError arrives with `data.error === null`, so the client's
      // explainer cannot tell it from an internal crash and renders the generic
      // "something went wrong" — telling a merely-throttled user Langy is broken.
      throw new LangyRateLimitedError();
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
 *
 * The provider segment ends at the FIRST slash; the model half may contain
 * slashes and colons of its own, because custom OpenAI-compatible providers
 * accept aggregator ids like "stealth/ox-alpha" or "deepseek/deepseek-r1:free",
 * which arrive here as "custom/stealth/ox-alpha".
 *
 * Every slash-separated segment must be non-empty, so "custom//stealth" and
 * "custom/stealth/" are refused: they carry a delimiter with no model behind
 * it, and the allowlist check downstream has nothing to match them against.
 */
const langyModelOverrideSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._:-]+)+$/,
    "modelOverride must be in 'provider/model' shape",
  )
  .max(200);

/**
 * A caller-chosen conversation id the create path may ADOPT, the same shape
 * gate the app layer enforces (`ADOPTABLE_CONVERSATION_ID`), applied at the
 * wire so a malformed id fails validation instead of reaching the aggregate.
 */
const adoptableConversationIdSchema = z
  .string()
  .regex(
    ADOPTABLE_CONVERSATION_ID,
    "conversationId must be 6-120 characters from [A-Za-z0-9_-]",
  );

/** Inputs shared by create + continue (the SAME turn-start operation). */
const langyTurnInputShape = {
  /**
   * Client-minted identity for ONE logical send: transport retries replay the
   * same key + content; a genuinely new send (the composer re-arming) mints a
   * fresh key. Reusing a key with different content is a 409.
   */
  idempotencyKey: z.string().min(8).max(128).optional(),
  /** @deprecated wire alias for pre-rename client bundles — same semantics. */
  requestId: z.string().uuid().optional(),
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
  langy,
  projectId,
  conversationId,
  turnId,
  userId,
}: {
  langy: App["langy"];
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
}): Promise<boolean> {
  const connection = tryGetApp()?.redis ?? null;
  if (connection) {
    const access = LangyTurnAccessStore.create({ redis: connection });
    if (
      await access.isTurnActor({ projectId, conversationId, turnId, userId })
    ) {
      return true;
    }
  }
  const conv = await langy.tryFindByIdVisible({
    id: conversationId,
    projectId,
    userId,
  });
  return !!conv;
}

/** How often the settlement watcher consults the durable fold + heartbeat. */
const SETTLEMENT_POLL_MS = 5_000;
/**
 * Consecutive settled reads required before synthesizing a terminal, so a single
 * projection blip can never end a live stream.
 */
const SETTLEMENT_CONFIRM_POLLS = 2;

/**
 * Poll a turn's durable fold + per-turn heartbeat while its live edge is being
 * tailed, and resolve to the terminal entry the buffer never received — or null
 * if the stream ended first (aborted) or the turn never settled.
 *
 * Split out of `onTurnStream` so the subscription body stays at the orchestration
 * level and this confirmation loop is independently testable. The safety gate
 * itself lives in {@link decideSyntheticTerminal}.
 */
async function watchForMissedTerminal({
  projectId,
  conversationId,
  turnId,
  userId,
  buffer,
  signal,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  buffer: {
    liveness(a: {
      conversationId: string;
      turnId: string;
    }): Promise<{ stale: boolean }>;
  };
  signal: AbortSignal;
}): Promise<LangyStreamEntry | null> {
  let settledStreak = 0;
  while (!signal.aborted) {
    if (!(await abortableDelay(SETTLEMENT_POLL_MS, signal))) return null;
    const [conversation, liveness] = await Promise.all([
      getApp()
    .langy.getById({ id: conversationId, projectId, userId })
        .catch(() => null),
      buffer.liveness({ conversationId, turnId }).catch(() => null),
    ]);
    if (!conversation || !liveness) {
      settledStreak = 0;
      continue;
    }
    const decision = decideSyntheticTerminal({
      status: conversation.status,
      lastError: conversation.lastError,
      heartbeatStale: liveness.stale,
    });
    if (!decision) {
      settledStreak = 0;
      continue;
    }
    settledStreak += 1;
    if (settledStreak >= SETTLEMENT_CONFIRM_POLLS) return decision;
  }
  return null;
}

/**
 * Dispatch a turn through the app-layer turn service. Create and Continue are
 * the SAME operation — `isNewConversation` is the only difference (it emits the
 * semantically-first `conversation_started`). The service throws DomainErrors,
 * which the shared `domainErrorMiddleware` maps to coded TRPCErrors carrying
 * `data.error` (read by the client's `readLangyTrpcError`).
 */
async function acceptTurn({
  langy,
  input,
  adoptConversationId,
  session,
}: {
  langy: App["langy"];
  input: {
    projectId: string;
    idempotencyKey?: string | undefined;
    requestId?: string | undefined;
    conversationId?: string | null;
    messages: LangyChatMessageInput[];
    modelOverride?: string;
    trigger?: "submit-message" | "regenerate-message" | "resume-stream";
    pageContext?: LangyTurnContext["pageContext"];
    skills?: LangyTurnContext["skills"];
  };
  /**
   * Adopt an unknown `conversationId` as a NEW conversation instead of minting
   * a fresh id. Only the CREATE path sets this, it is how a first message
   * lands on the conversation a panel-open warm already booted a worker for
   * (specs/langy/langy-worker-prewarm.feature). Continue keeps today's
   * semantics: an unknown id there is stale client state and mints fresh.
   */
  adoptConversationId?: boolean;
  session: Session;
}): Promise<{ conversationId: string; turnId: string }> {
  // Alias resolution for pre-rename client bundles; new clients send
  // idempotencyKey. Neither present is a malformed request. Imperative
  // rather than a schema .refine: the procedure base already carries a
  // projectId input, and tRPC merges .input() calls — which requires plain
  // object schemas, not the ZodEffects a refine produces.
  const idempotencyKey = input.idempotencyKey ?? input.requestId;
  if (!idempotencyKey) {
    const message = "idempotencyKey is required.";
    // `meta.message` is the channel that survives serialize() (ADR-045) — the
    // HandledError's own `message` is not put on the wire.
    throw new ValidationError(message, { meta: { message } });
  }
  return langy.startConversationTurn({
    projectId: input.projectId,
    idempotencyKey,
    session,
    requestedConversationId: input.conversationId ?? null,
    ...(adoptConversationId ? { adoptConversationId: true } : {}),
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
        const page = await ctx.app.langy.getPage({
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
  /**
   * The conversation's durable TURN events strictly after a cursor — the tail
   * the browser folds locally with the shared @langwatch/langy reducer
   * (ADR-059). Fired when a freshness signal's cursor is ahead of the local
   * fold's; authorized owner-or-shared exactly like the other reads (a
   * non-visible conversation reports not-found via the service's
   * HandledError). The response's `cursor` is the new local position;
   * `truncated` means fetch again from it.
   */
  conversationEventsAfter: langyReadProcedure
    .input(
      z.object({
        conversationId: z.string(),
        after: z.object({
          acceptedAt: z.number().int().nonnegative(),
          eventId: z.string(),
        }),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.app.langy.getEventsAfter({
        projectId: input.projectId,
        conversationId: input.conversationId,
        userId: ctx.session.user.id,
        after: input.after,
      });
    }),

  detail: langyReadProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(
      async ({ input, ctx }): Promise<LangyConversationDetailDto | null> => {
        // A freshness poll of the OPEN conversation — which may be the one the
        // user JUST started, whose fold has not been projected yet. So this is a
        // caller for which absence is a real answer: `findByIdVisible`, not
        // `getById`. Using the throwing form here would 500 the poll on every
        // first turn.
        const detail = await ctx.app.langy.tryFindByIdVisible({
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
        /**
         * WHICH turn is in flight — null when none is, and null in the brief
         * window between a message being sent and its turn being accepted on
         * the record (`CurrentTurnId` lands at `agent_turn_accepted`).
         *
         * The durable answer to "what would Stop stop?". A browser tab only
         * learns a turn id from its OWN send, so a turn it merely adopted from
         * this read — started in another tab, or rejoined after a refresh —
         * used to offer a Stop button with no id behind it: the click moved the
         * control to "Stopping" and dispatched nothing, while the agent kept
         * running. A tab-to-tab message could not fix that, because the worst
         * case is that no other tab exists; the record can, because it always
         * knew.
         */
        inFlightTurnId: string | null;
        /**
         * Whether the panel should ask "How did Langy do?" under the latest
         * answer — the backend-driven cadence (never a client heuristic; see
         * specs/langy/langy-feedback.feature). False while a turn is in
         * flight: the answer being rated must exist first.
         */
        shouldAskFeedback: boolean;
        /**
         * The projection's event cursor at this snapshot (ADR-059): the client
         * seeds its local fold here and catches up by fetching
         * `conversationEventsAfter` — never by replaying full history.
         */
        eventCursor: { acceptedAt: number; eventId: string } | null;
        /** The turn in flight, or null — what a refresh reattaches to. */
        currentTurnId: string | null;
        /**
         * The model the latest accepted turn ran on, or null before any turn
         * recorded one. Opening a conversation seeds the composer's picker
         * from it, so a conversation keeps the model it was last used with
         * across tabs and reloads.
         */
        lastModel: string | null;
      }> => {
        // Both reads go through user-scoped application services. The message
        // service performs its own visibility check; this detail read is also
        // needed for the durable turn status returned alongside the transcript.
        const conversation = await ctx.app.langy.getById({
          id: input.conversationId,
          projectId: input.projectId,
          userId: ctx.session.user.id,
        });
        const rows = await ctx.app.langy.getAllByConversation({
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
        const isTurnInFlight =
          conversation.status === LANGY_CONVERSATION_STATUS.ACTIVE ||
          conversation.status === LANGY_CONVERSATION_STATUS.RUNNING;
        const shouldAskFeedback = isTurnInFlight
          ? false
          : await ctx.app.langy.shouldAskFeedback({
              userId: ctx.session.user.id,
              conversationId: input.conversationId,
              assistantAnswerCount: messages.filter(
                (message) => message.role === "assistant",
              ).length,
            });
        return {
          messages,
          lastError:
            conversation.status === LANGY_CONVERSATION_STATUS.FAILED
              ? conversation.lastError
              : null,
          isTurnInFlight,
          // Only ever the id of a turn that IS in flight: a cleared/stale id
          // must never become a Stop target.
          inFlightTurnId: isTurnInFlight ? conversation.currentTurnId : null,
          shouldAskFeedback,
          eventCursor: conversation.eventCursor,
          currentTurnId: isTurnInFlight ? conversation.currentTurnId : null,
          lastModel: conversation.lastModel,
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
  deleteConversation: langyDeleteProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ input, ctx }): Promise<{ success: boolean }> => {
      const success = await ctx.app.langy.deleteById({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
      });
      return { success };
    }),

  /** Rename a conversation the caller owns through the event-sourced service. */
  renameConversation: langyUpdateProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<LangyConversationDetailDto> => {
      const detail = await ctx.app.langy.updateById({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
        title: input.title,
      });
      // Belt-and-braces for the declared `ConversationDetail | null`: the
      // service ALREADY throws this same typed error for both "no such
      // conversation" and "not yours" (deliberately indistinguishable), so in
      // practice this branch is unreachable. It stays because the return type
      // permits null and a silent `undefined` detail would be worse than a
      // redundant throw.
      if (!detail)
        throw new LangyConversationNotFoundError(input.conversationId);
      return toDetailDto(detail);
    }),

  /** Branch a visible conversation into a private, independently editable one. */
  forkConversation: langyCreateProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }): Promise<LangyConversationDetailDto> => {
      const { conversation } = await ctx.app.langy.forkById({
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
   * The Phase-1 gate (session + demo refusal + `langy:create` + rate limit)
   * is the `langyTurnProcedure`; the turn service throws DomainErrors that the
   * shared middleware maps to coded TRPCErrors.
   */
  createConversation: langyTurnProcedure
    .input(
      z.object({
        /**
         * The conversation a panel-open warm already booted a worker for
         * (specs/langy/langy-worker-prewarm.feature). Server-minted by
         * `warmWorker`, ADOPTED here so the first message reuses the warmed
         * worker instead of spawning under a fresh id. Absent = mint fresh,
         * exactly as before. Shape-gated at the wire; an id that exists but is
         * not adoptable (someone else's, archived) fails loudly in the service.
         */
        conversationId: adoptableConversationIdSchema.optional(),
        ...langyTurnInputShape,
      }),
    )
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{ conversationId: string; turnId: string }> => {
        return acceptTurn({
          langy: ctx.app.langy,
          input: {
            ...input,
            messages: input.messages as LangyChatMessageInput[],
          },
          ...(input.conversationId ? { adoptConversationId: true } : {}),
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
          langy: ctx.app.langy,
          input: {
            ...input,
            messages: input.messages as LangyChatMessageInput[],
          },
          session: ctx.session,
        });
      },
    ),

  /**
   * Stop an in-flight turn FOR REAL (ADR-078). The browser's `useChat` stop only
   * aborts its own subscription and lets the worker keep burning tokens; this
   * records the durable stopped terminal (the confirmation the client waits on),
   * ends the live stream, and best-effort asks the worker to abandon the run.
   *
   * `langy:create` — the same permission as sending — but deliberately NOT the
   * rate-limited `langyTurnProcedure`: a Stop must never be throttled. The
   * per-turn control gate (actor-or-owner, never a shared viewer) and its handled
   * `LangyConversationNotOwnedError` live in the service; idempotent — stopping an
   * already-finished turn is a harmless no-op.
   */
  stopTurn: langyCreateProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
        turnId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<{ stopped: boolean }> => {
      await ctx.app.langy.stopTurn({
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        userId: ctx.session.user.id,
      });
      return { stopped: true };
    }),

  /**
   * Pre-boot the conversation's worker on panel open, before the first message
   * (specs/langy/langy-worker-prewarm.feature). Returns the conversation id
   * the first message should adopt (server-minted when none is given) and
   * whether a worker is warm or warming.
   *
   * `langy:create`, warming provisions credentials and spawns a worker, so it
   * wants the same permission as sending, but deliberately NOT the
   * rate-limited `langyTurnProcedure`: a panel open must never consume the
   * per-user message budget. Strictly fire-and-forget for the caller: a warm
   * failure is a cold start, never an error, so nothing on the warm path
   * throws past this mutation (the access gates above it still do, a caller
   * without Langy gets the same refusal every langy procedure gives).
   */
  warmWorker: langyCreateProcedure
    .input(
      z.object({
        /** Warm an existing conversation's worker; absent mints the id the
         * first message will adopt. Same shape gate as adoption. */
        conversationId: adoptableConversationIdSchema.optional(),
        modelOverride: langyModelOverrideSchema.optional(),
      }),
    )
    .mutation(
      async ({
        input,
        ctx,
      }): Promise<{ conversationId: string | null; warmed: boolean }> => {
        try {
          // The warm skips langyTurnProcedure so a panel open never spends the
          // message budget, but each call can mint a conversation, mint a
          // session key and ask for a worker, so it carries its own looser
          // budget. Over it, the answer is the same silent one every other
          // warm failure gives: no error to the panel, a cold start on the
          // first message.
          const rl = await checkLangyWarmRateLimit({
            userId: ctx.session.user.id,
            projectId: input.projectId,
          });
          if (!rl.allowed) {
            logger.warn(
              { projectId: input.projectId },
              "langy warm rate limited, cold start on first message",
            );
            return {
              conversationId: input.conversationId ?? null,
              warmed: false,
            };
          }
          return await ctx.app.langy.warmConversationWorker({
            projectId: input.projectId,
            session: ctx.session,
            requestedConversationId: input.conversationId ?? null,
            ...(input.modelOverride
              ? { modelOverride: input.modelOverride }
              : {}),
          });
        } catch (error) {
          // The service already swallows warm-path failures; this is the belt
          // for anything unexpected around it. Never an error to the panel.
          logger.warn(
            { error, projectId: input.projectId },
            "langy warmWorker mutation failed, cold start on first message",
          );
          return {
            conversationId: input.conversationId ?? null,
            warmed: false,
          };
        }
      },
    ),

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
    async ({ input, ctx }): Promise<{ modelsAllowed: string[] | null }> => {
      const modelsAllowed =
        await ctx.app.langy.tryGetModelsAllowedForProject(
          input.projectId,
        );
      return { modelsAllowed };
    },
  ),

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
  // A write (it captures analytics and — per the documented follow-up — is
  // meant to write a feedback event onto the conversation's trace), so it
  // wants `langy:create`, not the read grant, matching the "reads want view,
  // writes want create" doctrine the router documents.
  recordFeedback: langyCreateProcedure
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
      // Only attach ids the caller actually owns. An unverified conversationId
      // /traceId would fabricate attribution today, and once the trace-event
      // follow-up lands it would let a caller write forged feedback onto any
      // trace. A conversationId the caller cannot see is dropped (not
      // rejected) so a genuine feedback ping still records its rating — it
      // just carries no cross-user attribution.
      let conversationId = input.conversationId;
      if (conversationId) {
        const conv = await ctx.app.langy.tryFindByIdVisible({
          id: conversationId,
          projectId: input.projectId,
          userId: ctx.session.user.id,
        });
        if (!conv) {
          logger.warn(
            {
              projectId: input.projectId,
              conversationId,
              userId: ctx.session.user.id,
            },
            "dropping langy feedback ids for a conversation the caller cannot see",
          );
          conversationId = undefined;
        }
      }
      // traceId is only trustworthy insofar as it belongs to a conversation
      // the caller owns; without a verified conversation it is dropped too, so
      // feedback can never be pinned to an arbitrary trace.
      const traceId = conversationId ? input.traceId : undefined;
      const messageId = conversationId ? input.messageId : undefined;

      trackServerEvent({
        userId: ctx.session.user.id,
        event: "langy_feedback",
        projectId: input.projectId,
        properties: {
          conversationId,
          messageId,
          traceId,
          rating: input.rating,
          sentiment: input.sentiment,
          comment: input.comment,
          shareConversationConsent: input.shareConversationConsent ?? false,
        },
      });
    }),

  /**
   * The feedback card was SHOWN — start the quiet period (the backend-driven
   * cadence, specs/langy/langy-feedback.feature). Showing counts as asking:
   * without this, an ignored card would re-appear under every answer, which is
   * exactly the nagging the cadence exists to prevent. A write, so it wants
   * `langy:create`, same as recordFeedback.
   */
  feedbackPromptShown: langyCreateProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }): Promise<void> => {
      // Same doctrine as recordFeedback: never act on a conversation id the
      // caller cannot actually see in this project. The visible-check runs the
      // project + ownership/shared rules, so a forged or foreign id is a
      // silent no-op instead of stamping the caller's cadence record with
      // attribution they don't own.
      const conversation = await ctx.app.langy.tryFindByIdVisible({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
      });
      if (!conversation) {
        logger.warn(
          {
            projectId: input.projectId,
            conversationId: input.conversationId,
            userId: ctx.session.user.id,
          },
          "dropping langy feedback-shown mark for a conversation the caller cannot see",
        );
        return;
      }
      await ctx.app.langy.markFeedbackShown({
        userId: ctx.session.user.id,
        conversationId: input.conversationId,
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
      // can't be used to probe another user's private conversation. Logged
      // because subscriptions are span- and log-silenced (SILENCED_LOG_TYPES),
      // so without this line a denied attach leaves no operator trace at all.
      if (
        !(await canWatchTurn({
          langy: opts.ctx.app.langy,
          projectId,
          conversationId,
          turnId,
          userId,
        }))
      ) {
        logger.warn(
          { projectId, conversationId, turnId, userId },
          "denied a langy turn-stream attach",
        );
        // Deliberately the same answer for "no such turn" and "not yours", so
        // this cannot probe another user's conversation — but typed, so the
        // client gets a coded payload instead of an untyped 404 it must render
        // as an unknown failure.
        throw new LangyConversationNotFoundError(conversationId);
      }
      // No Redis ⇒ no live buffer; the client falls back to the Postgres
      // conversation/message query.
      const connection = tryGetApp()?.redis ?? null;
      if (!connection) return;

      const blocking = connection.duplicate();
      const buffer = LangyTokenBuffer.create({
        redis: connection,
        blockingRedis: blocking,
      });
      // Tear down on client disconnect OR the hard per-turn deadline, whichever
      // comes first — a wedged turn must not hold a blocking connection forever.
      const signals: AbortSignal[] = [
        AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS),
      ];
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
          // A refresh mid-turn can miss the worker's terminal frame (its relay
          // connection dropped before it). follow() would then block until the
          // hard per-turn deadline, leaving the UI on the startup status for minutes
          // though the turn already finished. While we tail the live edge, watch
          // the durable fold + per-turn heartbeat; if the turn has settled with
          // no terminal in the buffer, synthesize one so the client resolves.
          const settle = new AbortController();
          const followSignal = AbortSignal.any([signal, settle.signal]);
          let synthesized: LangyStreamEntry | null = null;

          const watcher = watchForMissedTerminal({
            projectId,
            conversationId,
            turnId,
            userId,
            buffer,
            signal: followSignal,
          })
            .then((entry) => {
              if (!entry) return;
              synthesized = entry;
              settle.abort(); // unblock the follow() below
            })
            // Attached HERE, not in the finally below: follow() can block for
            // minutes, so a rejection would sit unhandled until then — and Node's
            // default --unhandled-rejections=throw would take the process down
            // first. A failed watcher just means no synthesized terminal.
            .catch(() => undefined);

          try {
            for await (const { entry } of buffer.follow({
              conversationId,
              turnId,
              fromId: lastId,
              signal: followSignal,
            })) {
              yield entry;
              if (entry.type === "end" || entry.type === "error") {
                // A real terminal reached the buffer — never override it.
                synthesized = null;
                return;
              }
            }
          } finally {
            settle.abort();
            await watcher; // already has its own .catch()
          }

          // follow() ended with no buffered terminal. If the watcher proved the
          // turn settled, deliver the synthesized terminal so the UI resolves
          // instead of hanging; the client reconciles the transcript via
          // langy.messages.
          if (synthesized) yield synthesized;
        }
      } finally {
        blocking.disconnect();
      }
    }),
});
