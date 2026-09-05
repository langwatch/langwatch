// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

/**
 * frontend).
 * The Langy conversation surface over the process's tRPC transport (ADR-046
 */
import { on } from "node:events";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  isLangyConversationUpdateVisibleToUser,
  LANGY_CONVERSATION_STATUS,
  langyConversationListCursorSchema,
  langyConversationStatusSchema,
  LangyConversationNotFoundError,
  langyMessageRoleSchema,
  LangyRateLimitedError,
  langyTurnContextSchema,
  type LangyConversationDetail as ConversationDetail,
  type LangyConversationDetailDto,
  type LangyConversationListCursorDto,
  type LangyConversationListItem as ConversationListItem,
  type LangyConversationListItemDto,
  type LangyCredentialSession,
  type LangyMessageDto,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { AGENT_CHAT_TIMEOUT_MS } from "../../services/langy-turn-errors.errors";
import { ADOPTABLE_CONVERSATION_ID } from "../../services/langy-conversation.service";
import type { LangyChatMessageInput } from "../../services/langy-turn.shared";
import type { LangyStreamEntry, LangyTokenBuffer } from "../../streaming/langy-token-buffer";
import { LangySessionRequiredError, type LangyApp } from "#app/langy.app";

const logger = createLogger("langwatch:langy:router");

/**
 * The process supplies authentication; authorization arrives as `policy`. `app` is the slice of the
 * process's application this feature reaches, not the feature's application itself, because a tRPC
 * root is shared by every feature mounted on it and so carries all of them.
 */
export type LangyTrpcContext = Readonly<{
  app: Readonly<{ langy: LangyApp }>;
  actor(): Readonly<{ id: string }>;
  /**
   * The authenticated session, handed to the turn service as the identity a
   * worker's credentials are minted for. Never read from the payload.
   */
  session: LangyCredentialSession | null;
}>;

type LangyTrpcProcedures<
  TContext extends LangyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization, audit, demo-refusal and
   * Langy-rollout policy for one declared permission.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The claim/complete side of the agent-to-page UI-action channel. */
export type LangyUiActionPort = Readonly<{
  claim(input: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
  }): Promise<{ isClaimed: boolean }>;
  complete(input: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
    completion: { ok: boolean; result?: unknown; errorCode?: string };
  }): Promise<{ isAccepted: boolean }>;
}>;

/**
 * The process capabilities this transport needs that are not Langy's own.
 */
export type LangyTrpcPorts = Readonly<{
  /**
   * The per-user message budget the deleted Hono `/langy/chat` handler carried.
   * Redis-backed; fails open when Redis is down (dev/test stay usable).
   */
  checkMessageRateLimit(input: {
    userId: string;
    projectId: string;
  }): Promise<{ allowed: boolean }>;
  /** The looser per-user budget a panel-open warm spends. */
  checkWarmRateLimit(input: { userId: string; projectId: string }): Promise<{ allowed: boolean }>;
  /** The process's product-analytics sink (server-side capture, never the browser). */
  recordProductEvent(input: {
    userId: string;
    projectId: string;
    event: string;
    properties: Record<string, unknown>;
  }): void;
  uiActions: LangyUiActionPort;
}>;

/** One chat message on the wire — role + opaque parts (bounded downstream). */
const langyTurnMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
});

/**
 * Per-send model override from the sidebar picker. Shape-validated here; the value is checked
 * against the project's Langy VK allowlist in the service.
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
  .regex(ADOPTABLE_CONVERSATION_ID, "conversationId must be 6-120 characters from [A-Za-z0-9_-]");

/** Every Langy procedure is project-scoped; the checks read this id. */
const projectScopeShape = { projectId: z.string() } as const;

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
  trigger: z.enum(["submit-message", "regenerate-message", "resume-stream"]).optional(),
  // Composer context chips (page context + skills) — bounded + sanitised in
  // renderLangyTurnContext; refs are never resolved by the control plane.
  ...langyTurnContextSchema.shape,
} as const;

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

/**
 * The authenticated session, proven present before it is handed to the turn service — which mints
 * this user's worker credentials from it.
 */
function sessionOf(ctx: LangyTrpcContext): LangyCredentialSession {
  ctx.actor();
  const session = ctx.session;
  if (!session) throw new LangySessionRequiredError();
  return session;
}

/**
 * Tails the live edge of a turn from `fromId`, watching the durable fold + per-turn heartbeat
 * concurrently so a settled turn whose terminal frame never reached the buffer still resolves for
 * the client instead of blocking until the hard per-turn deadline.
 */
async function* followMissedTerminal({
  app,
  projectId,
  conversationId,
  turnId,
  userId,
  buffer,
  fromId,
  signal,
}: {
  app: LangyApp;
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  buffer: LangyTokenBuffer;
  fromId: string;
  signal: AbortSignal;
}): AsyncGenerator<LangyStreamEntry> {
  const settle = new AbortController();
  const followSignal = AbortSignal.any([signal, settle.signal]);
  let synthesized: LangyStreamEntry | null = null;

  const watcher = app
    .watchForMissedTerminal({
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
      fromId,
      signal: followSignal,
    })) {
      yield entry;
      if (entry.type === "end" || entry.type === "error") {
        synthesized = null;
        return;
      }
    }
  } finally {
    settle.abort();
    await watcher;
  }

  if (synthesized) yield synthesized;
}

/**
 * Installs the complete `langy.*` tRPC surface on a process-owned root. The procedure and the
 * policy are injected by the process so its auth, audit, error, logging, tracing, demo-refusal and
 * rollout policies wrap every feature procedure consistently.
 */
export class LangyTrpcApi {
  static create<
    TContext extends LangyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LangyTrpcProcedures<TContext, TOptions, TRoot>,
    ports: LangyTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /**
     * A Langy procedure gated on one `langy:*` permission. Reads want `langy:view`; starting a turn
     * wants `langy:create`, because it provisions credentials, spawns a worker and spends the
     * project's model budget — not something a read grant should buy.
     */
    const langyProcedure = <TSchema extends z.ZodRawShape>(
      permission: "langy:view" | "langy:create" | "langy:update" | "langy:delete",
      shape: TSchema,
    ) => policy(permission)(procedure.input(z.object({ ...projectScopeShape, ...shape })));

    /**
     * The turn-start gate: `langy:create` PLUS the per-user message rate limit that used to live in
     * the Hono `/langy/chat` handler. A limited caller is refused BEFORE reaching the app layer, so
     * it never mints keys or dispatches a turn — exactly the precedence the route enforced.
     */
    const langyTurnProcedure = <TSchema extends z.ZodRawShape>(shape: TSchema) =>
      langyProcedure("langy:create", shape).use(async ({ ctx, input, next }) => {
        const rl = await ports.checkMessageRateLimit({
          userId: ctx.actor().id,
          projectId: (input as { projectId: string }).projectId,
        });
        if (!rl.allowed) {
          // handled condition, and only a handled error puts `data.error` on the wire. A raw
          // TRPCError arrives with `data.error === null`, so the client's explainer cannot tell it
          // from an internal crash and renders the generic "something went wrong" — telling a
          // merely- throttled user Langy is broken.
          // Typed, not a bare TRPCError: ADR-045 names rate-limited as a
          throw new LangyRateLimitedError();
        }
        return next();
      });

    return trpc.router({
      /**
       * Slim recent-conversations list. Reads only the spine columns; message content is never
       * fetched here. The client pairs this with `keepPreviousData` + `staleTime` so a freshness
       * refetch never blanks the list.
       */
      list: langyProcedure("langy:view", {
        limit: z.number().int().min(1).max(100).default(30),
        cursor: langyConversationListCursorSchema.optional(),
        query: z.string().trim().max(200).optional(),
      }).query(
        async ({
          input,
          ctx,
        }): Promise<{
          items: LangyConversationListItemDto[];
          nextCursor: LangyConversationListCursorDto | null;
        }> => {
          const page = await ctx.app.langy.listPage({
            projectId: input.projectId,
            userId: ctx.actor().id,
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
       * The conversation's durable TURN events strictly after a cursor — the tail the browser folds
       * locally with the shared @langwatch/langy reducer fold's;
       * (ADR-059). Fired when a freshness signal's cursor is ahead of the local
       */
      conversationEventsAfter: langyProcedure("langy:view", {
        conversationId: z.string(),
        after: z.object({
          acceptedAt: z.number().int().nonnegative(),
          eventId: z.string(),
        }),
      }).query(async ({ input, ctx }) => {
        return await ctx.app.langy.eventsAfter({
          projectId: input.projectId,
          conversationId: input.conversationId,
          userId: ctx.actor().id,
          after: input.after,
        });
      }),

      /**
       * Single-conversation spine (status + counts), for the open conversation.
       * Returns null when the conversation is not visible to the user.
       */
      detail: langyProcedure("langy:view", { conversationId: z.string() }).query(
        async ({ input, ctx }): Promise<LangyConversationDetailDto | null> => {
          // A freshness poll of the OPEN conversation — which may be the one the
          // user JUST started, whose fold has not been projected yet. So this is a
          // caller for which absence is a real answer: `tryFindByIdVisible`, not
          // `getById`. Using the throwing form here would 500 the poll on every
          // first turn.
          const detail = await ctx.app.langy.tryFindVisible({
            id: input.conversationId,
            projectId: input.projectId,
            userId: ctx.actor().id,
          });
          return detail ? toDetailDto(detail) : null;
        },
      ),

      /**
       * Heavy on-demand message history for a single conversation. Split from
       * `list` so opening a conversation never re-fetches the slim list, and the
       * list never carries content.
       */
      messages: langyProcedure("langy:view", { conversationId: z.string() }).query(
        async ({
          input,
          ctx,
        }): Promise<{
          messages: LangyMessageDto[];
          /**
           * The last turn's failure, serialized (a domain-error kind + safe meta — never raw text).
           * Null unless the conversation ended in one.
           */
          lastError: string | null;
          /**
           * Whether a turn is in flight RIGHT NOW, read off the fold, independent of any browser
           * stream.
           */
          isTurnInFlight: boolean;
          /**
           * WHICH turn is in flight — null when none is, and null in the brief window between a
           * message being sent and its turn being accepted on the record (`CurrentTurnId` lands at
           * `agent_turn_accepted`). The durable answer to "what would Stop stop?".
           */
          inFlightTurnId: string | null;
          /**
           * Whether the panel should ask "How did Langy do?" under the latest answer — the backend-
           * driven cadence (never a client heuristic; see specs/langy/langy-feedback.feature).
           * False while a turn is in flight: the answer being rated must exist first.
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
           * The model the latest accepted turn ran on, or null before any turn recorded one.
           * Opening a conversation seeds the composer's picker from it, so a conversation keeps the
           * model it was last used with across tabs and reloads.
           */
          lastModel: string | null;
        }> => {
          const userId = ctx.actor().id;
          // Both reads go through user-scoped application services. The message
          // service performs its own visibility check; this detail read is also
          // needed for the durable turn status returned alongside the transcript.
          const conversation = await ctx.app.langy.getById({
            id: input.conversationId,
            projectId: input.projectId,
            userId,
          });
          const rows = await ctx.app.langy.messages({
            conversationId: input.conversationId,
            projectId: input.projectId,
            userId,
          });
          const messages = rows.map<LangyMessageDto>((row) => ({
            id: row.id,
            role: langyMessageRoleSchema.catch("assistant").parse(row.role),
            parts: Array.isArray(row.parts) ? (row.parts as LangyMessageDto["parts"]) : [],
            createdAtMs: row.createdAt.getTime(),
          }));
          const isTurnInFlight =
            conversation.status === LANGY_CONVERSATION_STATUS.ACTIVE ||
            conversation.status === LANGY_CONVERSATION_STATUS.RUNNING;
          const shouldAskFeedback = isTurnInFlight
            ? false
            : await ctx.app.langy.shouldAskFeedback({
                userId,
                conversationId: input.conversationId,
                assistantAnswerCount: messages.filter((message) => message.role === "assistant")
                  .length,
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
       * Soft-delete (archive) a conversation the current user owns. Routes through the same command
       * the REST surface uses, which dispatches the event-sourced `archiveConversation` command —
       * never a raw row delete.
       */
      deleteConversation: langyProcedure("langy:delete", {
        conversationId: z.string(),
      }).mutation(async ({ input, ctx }): Promise<{ success: boolean }> => {
        const success = await ctx.app.langy.deleteConversation({
          id: input.conversationId,
          projectId: input.projectId,
          userId: ctx.actor().id,
        });
        return { success };
      }),

      /** Rename a conversation the caller owns through the event-sourced service. */
      renameConversation: langyProcedure("langy:update", {
        conversationId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
      }).mutation(async ({ input, ctx }): Promise<LangyConversationDetailDto> => {
        return toDetailDto(
          await ctx.app.langy.renameConversation({
            id: input.conversationId,
            projectId: input.projectId,
            userId: ctx.actor().id,
            title: input.title,
          }),
        );
      }),

      /** Branch a visible conversation into a private, independently editable one. */
      forkConversation: langyProcedure("langy:create", {
        conversationId: z.string().min(1),
      }).mutation(async ({ input, ctx }): Promise<LangyConversationDetailDto> => {
        return toDetailDto(
          await ctx.app.langy.forkConversation({
            id: input.conversationId,
            projectId: input.projectId,
            userId: ctx.actor().id,
          }),
        );
      }),

      /**
       * Start the FIRST turn of a NEW conversation. Mints a fresh conversation id, emits the
       * semantically-first `conversation_started`, then dispatches the turn. Returns the ids the
       * client subscribes to `onTurnStream` with.
       */
      createConversation: langyTurnProcedure({
        /**
         * The conversation a panel-open warm already booted a worker for (specs/langy/langy-worker-
         * prewarm.feature). Server-minted by `warmWorker`, ADOPTED here so the first message reuses
         * the warmed worker instead of spawning under a fresh id.
         */
        conversationId: adoptableConversationIdSchema.optional(),
        ...langyTurnInputShape,
      }).mutation(async ({ input, ctx }): Promise<{ conversationId: string; turnId: string }> => {
        return ctx.app.langy.startTurn(
          {
            projectId: input.projectId,
            idempotencyKey: input.idempotencyKey,
            requestId: input.requestId,
            conversationId: input.conversationId,
            messages: input.messages as LangyChatMessageInput[],
            modelOverride: input.modelOverride,
            trigger: input.trigger,
            turnContext: { pageContext: input.pageContext, skills: input.skills },
          },
          sessionOf(ctx),
          { adoptConversationId: Boolean(input.conversationId) },
        );
      }),

      /**
       * Continue an EXISTING conversation (same operation as create, minus the first-message
       * marker).
       */
      continueConversation: langyTurnProcedure({
        conversationId: z.string().min(1),
        ...langyTurnInputShape,
      }).mutation(async ({ input, ctx }): Promise<{ conversationId: string; turnId: string }> => {
        return ctx.app.langy.startTurn(
          {
            projectId: input.projectId,
            idempotencyKey: input.idempotencyKey,
            requestId: input.requestId,
            conversationId: input.conversationId,
            messages: input.messages as LangyChatMessageInput[],
            modelOverride: input.modelOverride,
            trigger: input.trigger,
            turnContext: { pageContext: input.pageContext, skills: input.skills },
          },
          sessionOf(ctx),
        );
      }),

      /**
       * aborts its own subscription and lets the worker keep burning tokens; this records the
       * durable stopped terminal (the confirmation the client waits on), ends the live stream,
       * Stop an in-flight turn FOR REAL (ADR-078). The browser's `useChat` stop only
       */
      stopTurn: langyProcedure("langy:create", {
        conversationId: z.string().min(1),
        turnId: z.string().min(1),
      }).mutation(async ({ input, ctx }): Promise<{ stopped: boolean }> => {
        await ctx.app.langy.stopTurn({
          projectId: input.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          userId: ctx.actor().id,
        });
        return { stopped: true };
      }),

      /**
       * The page asking to execute a dispatched UI action (specs/langy/langy-ui-actions.feature).
       * First successful claim wins across every tab and every stream replay; everyone else gets
       * `isClaimed: false` and drops.
       */
      claimUiAction: langyProcedure("langy:view", {
        conversationId: z.string(),
        actionId: z.string(),
      }).mutation(async ({ input, ctx }): Promise<{ isClaimed: boolean }> => {
        const userId = ctx.actor().id;
        const isVisible = await ctx.app.langy.isVisibleToCaller({
          id: input.conversationId,
          projectId: input.projectId,
          userId,
        });
        if (!isVisible) return { isClaimed: false };
        return await ports.uiActions.claim({
          projectId: input.projectId,
          userId,
          conversationId: input.conversationId,
          actionId: input.actionId,
        });
      }),

      /**
       * The page reporting a claimed action's outcome. Only the claiming user may
       * complete; anything else is dropped as `isAccepted: false`. The dispatch has
       * its own timeout, so a dropped completion cannot wedge the agent.
       */
      completeUiAction: langyProcedure("langy:view", {
        conversationId: z.string(),
        actionId: z.string(),
        ok: z.boolean(),
        result: z.unknown().optional(),
        errorCode: z.string().max(200).optional(),
      }).mutation(async ({ input, ctx }): Promise<{ isAccepted: boolean }> => {
        return await ports.uiActions.complete({
          projectId: input.projectId,
          userId: ctx.actor().id,
          conversationId: input.conversationId,
          actionId: input.actionId,
          completion: {
            ok: input.ok,
            ...(input.result !== undefined ? { result: input.result } : {}),
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          },
        });
      }),

      /**
       * Pre-boot the conversation's worker on panel open, before the first message
       * (specs/langy/langy-worker-prewarm.feature). Returns the conversation id the first message
       * should adopt (server-minted when none is given) and whether a worker is warm or warming.
       */
      warmWorker: langyProcedure("langy:create", {
        /** Warm an existing conversation's worker; absent mints the id the
         * first message will adopt. Same shape gate as adoption. */
        conversationId: adoptableConversationIdSchema.optional(),
        modelOverride: langyModelOverrideSchema.optional(),
      }).mutation(
        async ({ input, ctx }): Promise<{ conversationId: string | null; warmed: boolean }> => {
          try {
            // The warm skips the message budget so a panel open never spends it,
            // but each call can mint a conversation, mint a session key and ask
            // for a worker, so it carries its own looser budget. Over it, the
            // answer is the same silent one every other warm failure gives: no
            // error to the panel, a cold start on the first message.
            const rl = await ports.checkWarmRateLimit({
              userId: ctx.actor().id,
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
            return await ctx.app.langy.warmWorker({
              projectId: input.projectId,
              session: sessionOf(ctx),
              requestedConversationId: input.conversationId ?? null,
              ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
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
       * The model allowlist the composer's picker narrows to, or null when the project's Langy VK
       * sets none (every eligible model is allowed).
       */
      modelsAllowed: langyProcedure("langy:view", {}).query(
        async ({ input, ctx }): Promise<{ modelsAllowed: string[] | null }> => {
          const modelsAllowed = await ctx.app.langy.tryGetModelsAllowed(input.projectId);
          return { modelsAllowed };
        },
      ),

      /**
       * In-agent feedback capture ("How's Langy doing?" / thumbs).
       */
      recordFeedback: langyProcedure("langy:create", {
        conversationId: z.string().optional(),
        messageId: z.string().optional(),
        /** Trace id of the conversation turn, for LangWatch feedback events. */
        traceId: z.string().optional(),
        rating: z.enum(["up", "down"]),
        sentiment: z.enum(["frustrated", "delighted", "neutral"]).optional(),
        comment: z.string().max(2000).optional(),
        shareConversationConsent: z.boolean().optional(),
      }).mutation(async ({ input, ctx }): Promise<void> => {
        const userId = ctx.actor().id;
        // Only attach ids the caller actually owns. An unverified conversationId /traceId would
        // fabricate attribution today, and once the trace-event follow-up lands it would let a
        // caller write forged feedback onto any trace. A conversationId the caller cannot see is
        // dropped (not rejected) so a genuine feedback ping still records its rating — it just
        // carries no cross-user attribution.
        let conversationId = input.conversationId;
        if (conversationId) {
          const isVisible = await ctx.app.langy.isVisibleToCaller({
            id: conversationId,
            projectId: input.projectId,
            userId,
          });
          if (!isVisible) {
            logger.warn(
              {
                projectId: input.projectId,
                conversationId,
                userId,
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

        ports.recordProductEvent({
          userId,
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
       * The feedback card was SHOWN — start the quiet period (the backend-driven cadence,
       * specs/langy/langy-feedback.feature).
       */
      feedbackPromptShown: langyProcedure("langy:create", {
        conversationId: z.string().min(1),
      }).mutation(async ({ input, ctx }): Promise<void> => {
        const userId = ctx.actor().id;
        // Same doctrine as recordFeedback: never act on a conversation id the
        // caller cannot actually see in this project. The visible-check runs the
        // project + ownership/shared rules, so a forged or foreign id is a
        // silent no-op instead of stamping the caller's cadence record with
        // attribution they don't own.
        const isVisible = await ctx.app.langy.isVisibleToCaller({
          id: input.conversationId,
          projectId: input.projectId,
          userId,
        });
        if (!isVisible) {
          logger.warn(
            {
              projectId: input.projectId,
              conversationId: input.conversationId,
              userId,
            },
            "dropping langy feedback-shown mark for a conversation the caller cannot see",
          );
          return;
        }
        await ctx.app.langy.markFeedbackShown({
          userId,
          conversationId: input.conversationId,
        });
      }),

      /**
       * SSE subscription pushing `langy_conversation_updated` signals to active browsers when a
       * conversation's fold projection advances. The client listens, cancels + invalidates its
       * TanStack cache, and refetches the slim projection — landing fresh data without a data push.
       */
      onConversationUpdate: langyProcedure("langy:view", {}).subscription(async function* (opts) {
        const { projectId } = opts.input;
        const userId = opts.ctx.actor().id;
        const emitter = opts.ctx.app.langy.conversationUpdates(projectId);
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
          opts.ctx.app.langy.releaseConversationUpdates(projectId);
        }
      }),

      /**
       * The live turn stream. Yields the durable token-buffer entries for one turn (delta / tool /
       * status / progress / milestone / end / error) as an ordered async generator — the tRPC
       * replacement for the deleted Hono `/chat` + `/stream` UIMessage SSE.
       */
      onTurnStream: langyProcedure("langy:view", {
        conversationId: z.string(),
        turnId: z.string(),
      })
        // The yield type is inferred from the buffer's `LangyStreamEntry` entries, so no
        // explicit `: AsyncGenerator<…>` return annotation is needed.
        .subscription(async function* (opts) {
          const { projectId, conversationId, turnId } = opts.input;
          const userId = opts.ctx.actor().id;

          // Same gate the deleted `/stream` route used. Reported as not-found so it
          // can't be used to probe another user's private conversation. Logged
          // because subscriptions are span- and log-silenced (SILENCED_LOG_TYPES),
          // so without this line a denied attach leaves no operator trace at all.
          if (
            !(await opts.ctx.app.langy.canWatchTurn({
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
          const stream = opts.ctx.app.langy.tryOpenTurnStream();
          if (!stream) return;

          const { buffer } = stream;
          // Tear down on client disconnect OR the hard per-turn deadline, whichever
          // comes first — a wedged turn must not hold a blocking connection forever.
          const signals: AbortSignal[] = [AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS)];
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
              // A refresh mid-turn can miss the worker's terminal frame (its relay connection
              // dropped before it). follow() would then block until the hard per-turn deadline,
              // leaving the UI on the startup status for minutes though the turn already finished.
              yield* followMissedTerminal({
                app: opts.ctx.app.langy,
                projectId,
                conversationId,
                turnId,
                userId,
                buffer,
                fromId: lastId,
                signal,
              });
            }
          } finally {
            stream.close();
          }
        }),
    });
  }
}
