// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

/**
 * frontend).
 * The Langy conversation surface over the process's tRPC transport (ADR-046
 */
import { on } from "node:events";
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  isLangyConversationUpdateVisibleToUser,
  langyConversationDeletedSchema,
  langyConversationDetailSchema,
  langyConversationEventPageDtoSchema,
  langyConversationListPageDtoSchema,
  langyConversationMessagesDtoSchema,
  langyConversationUpdateFrameSchema,
  langyModelsAllowedSchema,
  langyStreamEntrySchema,
  langyTurnStartedSchema,
  langyTurnStoppedSchema,
  langyUiActionClaimedSchema,
  langyUiActionCompletedSchema,
  langyWarmedWorkerSchema,
  LANGY_CONVERSATION_STATUS,
  langyConversationListCursorSchema,
  langyConversationStatusSchema,
  LangyConversationNotFoundError,
  langyMessageRoleSchema,
  LangyLocalSkipModelNotAllowedError,
  langyCodeAccessPreferenceSchema,
  langyLocalRecordSchema,
  langyLocalWorkspaceStatusSchema,
  LangyRateLimitedError,
  LangyWaitExpiredError,
  langyTurnContextSchema,
  type LangyConversationDetail as ConversationDetail,
  type LangyConversationDetailDto,
  type LangyConversationListItem as ConversationListItem,
  type LangyConversationListItemDto,
  type LangyCredentialSession,
  type LangyMessageDto,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { AGENT_CHAT_TIMEOUT_MS } from "@langwatch/langy-contract";
import { ADOPTABLE_CONVERSATION_ID } from "../../services/langy-conversation.service.ts";
import type { LangyChatMessageInput } from "../../services/langy-turn-shared.service.ts";
import type { LangyStreamEntry } from "@langwatch/langy-contract";
import type { LangyTokenBufferAdapter } from "../../adapters/redis.langy-token-buffer.adapter.ts";
import { LangySessionRequiredError, type LangyApp } from "#app/langy.app";
import type { LocalControlRuntime } from "../../adapters/langy-local-control-runtime.adapter.ts";
import { workspaceChannel } from "../../rules/langy-local-control-keys.rules.ts";
import { reconcileSkipPolicy } from "../../rules/langy-local-skip-policy.rules.ts";
import { ControlRequestService } from "../../services/langy-local-control-request.service.ts";
import type { SkipPermissionsDecision } from "../../services/langy-skip-permissions.service.ts";
import { nowInstant } from "@langwatch/time";

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
  /**
   * Check every answer against the output schema its procedure declares. The
   * process decides: development and test ask for it, production does not.
   */
  validateOutput?: boolean;
}>;

/**
 * The `.use()` surface every tRPC procedure builder shares, named structurally
 * at the one seam that stacks the rate-limit middleware onto a builder whose
 * generics belong to the process.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/** What the rate-limit middleware reads: the caller, the parsed project, and `next`. */
type RateLimitMiddlewareOptions = {
  ctx: LangyTrpcContext;
  input: { projectId: string };
  next: () => unknown;
};

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
  /**
   * The developer's own machine, where this process composed it (ADR-129). The
   * SAME runtime the worker's REST door reads: two over process memory would
   * answer two different folders for one conversation.
   */
  local: LangyLocalTrpcPorts;
}>;

/** What the panel's own local-control procedures reach outside Langy. */
export type LangyLocalTrpcPorts = Readonly<{
  runtime: LocalControlRuntime;
  /** The durable record of a policy change and of a closed folder. */
  commands: Readonly<{
    changeLocalPolicy(input: {
      tenantId: string;
      occurredAt: number;
      conversationId: string;
      userId: string;
      skipPermissions: boolean;
      model?: string;
    }): Promise<unknown>;
    disconnectLocalWorkspace(input: {
      tenantId: string;
      occurredAt: number;
      conversationId: string;
      instanceId: string;
      reason: string;
    }): Promise<unknown>;
  }>;
  /** Whether the conversation's model may skip permission cards. */
  skipGate(input: { projectId: string; model: string }): Promise<SkipPermissionsDecision>;
  /** The person's own remembered code access choice. */
  codeAccess: Readonly<{
    tryRead(userId: string): Promise<string | null>;
    write(input: { userId: string; preference: "github" | null }): Promise<void>;
  }>;
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
    lastActivityAtMs: item.lastActivityAt.epochMilliseconds,
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
  buffer: LangyTokenBufferAdapter;
  fromId: string;
  signal: AbortSignal;
}): AsyncGenerator<LangyStreamEntry> {
  const settle = new AbortController();
  const followSignal = AbortSignal.any([signal, settle.signal]);
  let synthesized: LangyStreamEntry | null = null;

  const watcher = app
    .tryWatchForMissedTerminal({
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
    const validateOutput = procedures.validateOutput ?? false;

    /**
     * Every Langy procedure is project-scoped, so its parser always carries the
     * project id the declared check reads. Separate from the access decorator
     * because the chain applies the parser first and the policy after.
     */
    const langyInput = <TSchema extends z.ZodRawShape>(shape: TSchema) =>
      z.object({ ...projectScopeShape, ...shape });

    /**
     * The turn-start gate: `langy:create` PLUS the per-user message rate limit that used to live in
     * the Hono `/langy/chat` handler. A limited caller is refused BEFORE reaching the app layer, so
     * it never mints keys or dispatches a turn — exactly the precedence the route enforced.
     */
    const turnStartPolicy: TrpcPolicyDecorator = (target) =>
      (policy("langy:create")(target) as ChainableProcedure).use(
        async ({ ctx, input, next }: RateLimitMiddlewareOptions) => {
          const rl = await ports.checkMessageRateLimit({
            userId: ctx.actor().id,
            projectId: input.projectId,
          });
          if (!rl.allowed) {
            // Typed, not a bare TRPCError: ADR-045 names rate-limited as a
            // handled condition, and only a handled error puts `data.error` on the wire. A raw
            // TRPCError arrives with `data.error === null`, so the client's explainer cannot tell it
            // from an internal crash and renders the generic "something went wrong" — telling a
            // merely-throttled user Langy is broken.
            throw new LangyRateLimitedError();
          }
          return next();
        },
      ) as typeof target;

    const conversations = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * Slim recent-conversations list. Reads only the spine columns; message content is never
       * fetched here. The client pairs this with `keepPreviousData` + `staleTime` so a freshness
       * refetch never blanks the list.
       */

      .query("list", (p) =>
        p
          .withInput(
            langyInput({
              limit: z.number().int().min(1).max(100).default(30),
              cursor: langyConversationListCursorSchema.optional(),
              query: z.string().trim().max(200).optional(),
            }),
          )
          .withOutput(langyConversationListPageDtoSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
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
          }),
      )

      /**
       * The conversation's durable TURN events strictly after a cursor — the tail the browser folds
       * locally with the shared @langwatch/langy reducer fold's;
       * (ADR-059). Fired when a freshness signal's cursor is ahead of the local
       */

      .query("conversationEventsAfter", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
              after: z.object({
                acceptedAt: z.number().int().nonnegative(),
                eventId: z.string(),
              }),
            }),
          )
          .withOutput(langyConversationEventPageDtoSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
            return await ctx.app.langy.eventsAfter({
              projectId: input.projectId,
              conversationId: input.conversationId,
              userId: ctx.actor().id,
              after: input.after,
            });
          }),
      )

      /**
       * Single-conversation spine (status + counts), for the open conversation.
       * Returns null when the conversation is not visible to the user.
       */

      .query("detail", (p) =>
        p
          .withInput(langyInput({ conversationId: z.string() }))
          .withOutput(langyConversationDetailSchema.nullable())
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
            // A freshness poll of the OPEN conversation — which may be the one the
            // user JUST started, whose fold has not been projected yet. So this is a
            // caller for which absence is a real answer: `findByIdVisible`, not
            // `getById`. Using the throwing form here would 500 the poll on every
            // first turn.
            const detail = await ctx.app.langy.tryFindVisible({
              id: input.conversationId,
              projectId: input.projectId,
              userId: ctx.actor().id,
            });
            return detail ? toDetailDto(detail) : null;
          }),
      )

      /**
       * Heavy on-demand message history for a single conversation. Split from
       * `list` so opening a conversation never re-fetches the slim list, and the
       * list never carries content.
       */

      .query("messages", (p) =>
        p
          .withInput(langyInput({ conversationId: z.string() }))
          .withOutput(langyConversationMessagesDtoSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
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
              createdAtMs: row.createdAt.epochMilliseconds,
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
          }),
      )

      /**
       * Soft-delete (archive) a conversation the current user owns. Routes through the same command
       * the REST surface uses, which dispatches the event-sourced `archiveConversation` command —
       * never a raw row delete.
       */

      .mutation("deleteConversation", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
            }),
          )
          .withOutput(langyConversationDeletedSchema)
          .withPermission("langy:delete")
          .handle(async ({ input, ctx }) => {
            const success = await ctx.app.langy.deleteConversation({
              id: input.conversationId,
              projectId: input.projectId,
              userId: ctx.actor().id,
            });
            return { success };
          }),
      )

      /** Rename a conversation the caller owns through the event-sourced service. */

      .mutation("renameConversation", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string().min(1),
              title: z.string().trim().min(1).max(200),
            }),
          )
          .withOutput(langyConversationDetailSchema)
          .withPermission("langy:update")
          .handle(async ({ input, ctx }) => {
            return toDetailDto(
              await ctx.app.langy.renameConversation({
                id: input.conversationId,
                projectId: input.projectId,
                userId: ctx.actor().id,
                title: input.title,
              }),
            );
          }),
      )

      /** Branch a visible conversation into a private, independently editable one. */

      .mutation("forkConversation", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string().min(1),
            }),
          )
          .withOutput(langyConversationDetailSchema)
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
            return toDetailDto(
              await ctx.app.langy.forkConversation({
                id: input.conversationId,
                projectId: input.projectId,
                userId: ctx.actor().id,
              }),
            );
          }),
      )
      .build();

    const turns = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * Start the FIRST turn of a NEW conversation. Mints a fresh conversation id, emits the
       * semantically-first `conversation_started`, then dispatches the turn. Returns the ids the
       * client subscribes to `onTurnStream` with.
       */

      .mutation("createConversation", (p) =>
        p
          .withInput(
            langyInput({
              /**
               * The conversation a panel-open warm already booted a worker for (specs/langy/langy-worker-
               * prewarm.feature). Server-minted by `warmWorker`, ADOPTED here so the first message reuses
               * the warmed worker instead of spawning under a fresh id.
               */
              conversationId: adoptableConversationIdSchema.optional(),
              ...langyTurnInputShape,
            }),
          )
          .withOutput(langyTurnStartedSchema)
          .withCustomPermission(
            turnStartPolicy,
            "the langy:create check plus the per-user message budget the deleted Hono /langy/chat handler carried, applied in that order so a throttled caller never mints keys or dispatches a turn",
          )
          .handle(async ({ input, ctx }) => {
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
      )

      /**
       * Continue an EXISTING conversation (same operation as create, minus the first-message
       * marker).
       */

      .mutation("continueConversation", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string().min(1),
              ...langyTurnInputShape,
            }),
          )
          .withOutput(langyTurnStartedSchema)
          .withCustomPermission(
            turnStartPolicy,
            "the langy:create check plus the per-user message budget the deleted Hono /langy/chat handler carried, applied in that order so a throttled caller never mints keys or dispatches a turn",
          )
          .handle(async ({ input, ctx }) => {
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
      )

      /**
       * aborts its own subscription and lets the worker keep burning tokens; this records the
       * durable stopped terminal (the confirmation the client waits on), ends the live stream,
       * Stop an in-flight turn FOR REAL (ADR-078). The browser's `useChat` stop only
       */

      .mutation("stopTurn", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string().min(1),
              turnId: z.string().min(1),
            }),
          )
          .withOutput(langyTurnStoppedSchema)
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
            await ctx.app.langy.stopTurn({
              projectId: input.projectId,
              conversationId: input.conversationId,
              turnId: input.turnId,
              userId: ctx.actor().id,
            });
            return { stopped: true };
          }),
      )

      /**
       * The page asking to execute a dispatched UI action (specs/langy/langy-ui-actions.feature).
       * First successful claim wins across every tab and every stream replay; everyone else gets
       * `isClaimed: false` and drops.
       */

      .mutation("claimUiAction", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
              actionId: z.string(),
            }),
          )
          .withOutput(langyUiActionClaimedSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
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
      )

      /**
       * The page reporting a claimed action's outcome. Only the claiming user may
       * complete; anything else is dropped as `isAccepted: false`. The dispatch has
       * its own timeout, so a dropped completion cannot wedge the agent.
       */

      .mutation("completeUiAction", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
              actionId: z.string(),
              ok: z.boolean(),
              result: z.unknown().optional(),
              errorCode: z.string().max(200).optional(),
            }),
          )
          .withOutput(langyUiActionCompletedSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
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
      )

      /**
       * Pre-boot the conversation's worker on panel open, before the first message
       * (specs/langy/langy-worker-prewarm.feature). Returns the conversation id the first message
       * should adopt (server-minted when none is given) and whether a worker is warm or warming.
       */

      .mutation("warmWorker", (p) =>
        p
          .withInput(
            langyInput({
              /** Warm an existing conversation's worker; absent mints the id the
               * first message will adopt. Same shape gate as adoption. */
              conversationId: adoptableConversationIdSchema.optional(),
              modelOverride: langyModelOverrideSchema.optional(),
            }),
          )
          .withOutput(langyWarmedWorkerSchema)
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
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
          }),
      )

      /**
       * The model allowlist the composer's picker narrows to, or null when the project's Langy VK
       * sets none (every eligible model is allowed).
       */

      .query("modelsAllowed", (p) =>
        p
          .withInput(langyInput({}))
          .withOutput(langyModelsAllowedSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
            const modelsAllowed = await ctx.app.langy.findModelsAllowed(input.projectId);
            return { modelsAllowed };
          }),
      )
      .build();

    const feedback = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * In-agent feedback capture ("How's Langy doing?" / thumbs).
       */

      .mutation("recordFeedback", (p) =>
        p
          .withInput(
            langyInput({
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
          .withOutput(z.void())
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
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
      )

      /**
       * The feedback card was SHOWN — start the quiet period (the backend-driven cadence,
       * specs/langy/langy-feedback.feature).
       */

      .mutation("feedbackPromptShown", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string().min(1),
            }),
          )
          .withOutput(z.void())
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
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
      )

      /**
       * SSE subscription pushing `langy_conversation_updated` signals to active browsers when a
       * conversation's fold projection advances. The client listens, cancels + invalidates its
       * TanStack cache, and refetches the slim projection — landing fresh data without a data push.
       */

      .subscription("onConversationUpdate", (p) =>
        p
          .withInput(langyInput({}))
          .withOutput(langyConversationUpdateFrameSchema)
          .withPermission("langy:view")
          .handle(async function* (opts) {
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
      )

      /**
       * The live turn stream. Yields the durable token-buffer entries for one turn (delta / tool /
       * status / progress / milestone / end / error) as an ordered async generator — the tRPC
       * replacement for the deleted Hono `/chat` + `/stream` UIMessage SSE.
       */

      .subscription("onTurnStream", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
              turnId: z.string(),
            }),
          )
          .withOutput(langyStreamEntrySchema)
          .withPermission("langy:view")
          .handle(async function* (opts) {
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
      )
      .build();

    /**
     * The developer's own machine, as the panel drives it (ADR-129): the cards
     * it raised, the folder's state, and the two answers a person gives.
     */
    const requireOwn = async (
      ctx: { app: { langy: LangyApp }; actor(): { id: string } },
      input: { projectId: string; conversationId: string },
    ): Promise<ConversationDetail> => {
      const conversation = await ctx.app.langy.tryFindVisible({
        id: input.conversationId,
        projectId: input.projectId,
        userId: ctx.actor().id,
      });
      if (!conversation) throw new LangyConversationNotFoundError(input.conversationId);
      return conversation;
    };

    /**
     * The card, when it belongs to a conversation this caller can act on. The
     * wait names its own conversation and project, so answering with an id from
     * another chat refuses before the answer reaches the folder.
     */
    const requireOwnWait = async (
      ctx: { app: { langy: LangyApp }; actor(): { id: string } },
      input: { projectId: string; conversationId: string; waitId: string },
    ): Promise<void> => {
      await requireOwn(ctx, input);
      const wait = await ports.local.runtime.waits.tryRead(input.waitId);
      if (
        !wait ||
        wait.projectId !== input.projectId ||
        wait.conversationId !== input.conversationId
      ) {
        throw new LangyWaitExpiredError({ waitId: input.waitId });
      }
    };

    const recordPolicy = (input: {
      projectId: string;
      conversationId: string;
      userId: string;
      skipPermissions: boolean;
      model: string;
    }) =>
      ports.local.commands.changeLocalPolicy({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        conversationId: input.conversationId,
        userId: input.userId,
        skipPermissions: input.skipPermissions,
        ...(input.model ? { model: input.model } : {}),
      });

    const local = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("localRecord", (p) =>
        p
          .withInput(langyInput({ conversationId: z.string() }))
          .withOutput(langyLocalRecordSchema)
          .withPermission("langy:view")
          .handle(({ input, ctx }) =>
            ctx.app.langy.getLocalRecord({
              projectId: input.projectId,
              conversationId: input.conversationId,
              userId: ctx.actor().id,
            }),
          ),
      )

      .query("getLocalWorkspace", (p) =>
        p
          .withInput(langyInput({ conversationId: z.string() }))
          .withOutput(langyLocalWorkspaceStatusSchema)
          .withPermission("langy:view")
          .handle(async ({ input, ctx }) => {
            const userId = ctx.actor().id;
            const conversation = await requireOwn(ctx, input);
            const runtime = ports.local.runtime;
            const connected = await runtime.presence.read(input.conversationId);
            const pendingRequest = await runtime.requests.tryFindOpenForConversation({
              projectId: input.projectId,
              userId,
              conversationId: input.conversationId,
            });
            const preference = await ports.local.codeAccess.tryRead(userId);
            // The card offers the skip switch only when the model behind the
            // conversation is on its provider's list, so the panel reads the
            // same answer the permission card was built with.
            const skipAllowed = conversation.lastModel
              ? (
                  await ports.local.skipGate({
                    projectId: input.projectId,
                    model: conversation.lastModel,
                  })
                ).allowed
              : false;
            return {
              connected: connected !== null,
              workspace: connected
                ? { ...connected.workspace, hostname: connected.hostname }
                : null,
              skipAllowed,
              skipPermissions: await reconcileSkipPolicy({
                runtime,
                projectId: input.projectId,
                conversationId: input.conversationId,
                model: conversation.lastModel,
                skipGate: ports.local.skipGate,
                changePolicy: (args) =>
                  recordPolicy({ ...args, projectId: input.projectId }).then(() => undefined),
              }),
              pendingRequest: pendingRequest ? ControlRequestService.toWire(pendingRequest) : null,
              codeAccessPreference: preference === "github" ? ("github" as const) : null,
            };
          }),
      )

      .query("getCodeAccessPreference", (p) =>
        p
          .withInput(langyInput({}))
          .withOutput(langyCodeAccessPreferenceSchema)
          .withPermission("langy:view")
          .handle(async ({ ctx }) => ({
            preference:
              (await ports.local.codeAccess.tryRead(ctx.actor().id)) === "github"
                ? ("github" as const)
                : null,
          })),
      )

      .mutation("answerLocalPermission", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
              waitId: z.string(),
              decision: z.enum(["allow_once", "allow_pattern", "deny"]),
            }),
          )
          .withOutput(z.object({ answered: z.literal(true) }))
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
            await requireOwnWait(ctx, input);
            await ports.local.runtime.waits.answer({
              waitId: input.waitId,
              userId: ctx.actor().id,
              decision: input.decision,
            });
            return { answered: true as const };
          }),
      )

      .mutation("answerQuestion", (p) =>
        p
          .withInput(
            langyInput({
              conversationId: z.string(),
              waitId: z.string(),
              answers: z
                .array(
                  z.object({
                    question: z.string(),
                    selected: z.array(z.string()),
                    other: z.string().max(4000).optional(),
                  }),
                )
                .min(1)
                .max(4),
            }),
          )
          .withOutput(z.object({ answered: z.literal(true) }))
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
            await requireOwnWait(ctx, input);
            await ports.local.runtime.waits.answer({
              waitId: input.waitId,
              userId: ctx.actor().id,
              answers: input.answers.map((answer) => ({
                question: answer.question,
                selected: answer.selected,
                ...(answer.other !== undefined ? { other: answer.other } : {}),
              })),
            });
            return { answered: true as const };
          }),
      )

      /**
       * Turn the permission cards off for this conversation, or back on.
       * Server owns only whether the model is on its provider's allowed list;
       * the command line keeps its own folder boundary and privilege rule.
       */
      .mutation("setLocalPolicy", (p) =>
        p
          .withInput(langyInput({ conversationId: z.string(), skipPermissions: z.boolean() }))
          .withOutput(z.object({ skipPermissions: z.boolean() }))
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
            const conversation = await requireOwn(ctx, input);
            const runtime = ports.local.runtime;
            let model = conversation.lastModel ?? "";
            if (input.skipPermissions) {
              const decision = await ports.local.skipGate({
                projectId: input.projectId,
                model,
              });
              if (!decision.allowed) {
                throw new LangyLocalSkipModelNotAllowedError({
                  model: decision.modelId || model,
                  provider: decision.provider,
                });
              }
              model = `${decision.provider}/${decision.modelId}`;
            }
            await runtime.presence.writePolicy({
              conversationId: input.conversationId,
              skipPermissions: input.skipPermissions,
            });
            await recordPolicy({
              projectId: input.projectId,
              conversationId: input.conversationId,
              userId: ctx.actor().id,
              skipPermissions: input.skipPermissions,
              model,
            });
            await runtime.store.publish(
              workspaceChannel(input.conversationId),
              JSON.stringify({ policy: { skipPermissions: input.skipPermissions } }),
            );
            return { skipPermissions: input.skipPermissions };
          }),
      )

      /** Close the shared folder from the panel header chip. */
      .mutation("disconnectLocalWorkspace", (p) =>
        p
          .withInput(langyInput({ conversationId: z.string() }))
          .withOutput(z.object({ disconnected: z.boolean() }))
          .withPermission("langy:create")
          .handle(async ({ input, ctx }) => {
            await requireOwn(ctx, input);
            const runtime = ports.local.runtime;
            const workspace = await runtime.presence.read(input.conversationId);

            // Revoke first, unconditionally: the frame below is best effort, and
            // a reconnect must not pass auth on a binding that outlives it.
            await runtime.requests.revokeConversationBindings(input.conversationId);
            await runtime.store.publish(
              workspaceChannel(input.conversationId),
              JSON.stringify({
                disconnect: { reason: "Disconnected from the LangWatch panel." },
              }),
            );
            await runtime.presence.deregister({ conversationId: input.conversationId });
            for (const call of await runtime.dispatcher.listPendingForConversation(
              input.conversationId,
            )) {
              await runtime.dispatcher.tryCancel({
                callId: call.callId,
                message: "The shared folder was disconnected, so the command did not finish.",
              });
            }
            // The durable line belongs to a folder that was there. With no
            // record to name, the revoke above is the whole of what this did.
            if (!workspace) return { disconnected: false };
            await ports.local.commands.disconnectLocalWorkspace({
              tenantId: input.projectId,
              occurredAt: nowInstant().epochMilliseconds,
              conversationId: input.conversationId,
              instanceId: workspace.instanceId,
              reason: "panel",
            });
            return { disconnected: true };
          }),
      )

      /** Remember, or forget, how Langy should reach this person's code. */
      .mutation("setCodeAccessPreference", (p) =>
        p
          .withInput(langyInput({ preference: z.enum(["github"]).nullable() }))
          .withOutput(langyCodeAccessPreferenceSchema)
          .withPermission("langy:update")
          .handle(async ({ input, ctx }) => {
            await ports.local.codeAccess.write({
              userId: ctx.actor().id,
              preference: input.preference,
            });
            return { preference: input.preference };
          }),
      )
      .build();

    // One surface, defined in the groups the panel is laid out in. Several
    // chains rather than one because a single eighteen-procedure chain exceeds
    // TypeScript's instantiation depth, and `mergeRouters` puts them back on
    // the one `langy.*` name the client has always called.
    return trpc.mergeRouters(conversations, turns, feedback, local);
  }
}
