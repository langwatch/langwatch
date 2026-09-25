import { ValidationError } from "@langwatch/handled-error";
import {
  LANGY_CONVERSATION_STATUS,
  LangyConversationNotFoundError,
  langyConversationStatusSchema,
  langyConversationUpdateFrameSchema,
  langyMessageRoleSchema,
  LangyRateLimitedError,
  isLangyConversationUpdateVisibleToUser,
  type LangyConversationDetail,
  type LangyConversationDetailDto,
  type LangyConversationEventPageDto,
  type LangyConversationListItem,
  type LangyConversationListItemDto,
  type LangyConversationListPageDto,
  type LangyConversationMessagesDto,
  type LangyPanelCall,
  type LangyPanelCaller,
  type LangyStreamEntry,
  type langyContinueConversationInputSchema,
  type langyPanelConversationInputSchema,
  type langyPanelCreateConversationInputSchema,
  type langyEventsAfterInputSchema,
  type langyFeedbackPromptShownInputSchema,
  type langyForkInputSchema,
  type langyListInputSchema,
  type langyProjectInputSchema,
  type langyRecordFeedbackInputSchema,
  type langyRenameInputSchema,
  type langyStopTurnPanelInputSchema,
  type langyTurnStreamInputSchema,
  type langyClaimUiActionInputSchema,
  type langyCompleteUiActionInputSchema,
  type langyWarmWorkerInputSchema,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { z } from "zod";

import type { LangyTurnAccessRepository } from "../repositories/langy-live-turn.repository.ts";
import { deriveSyntheticTerminal } from "../rules/langy-turn-settlement.rules.ts";
import type { TurnHealth } from "../rules/langy-turn-settlement.rules.ts";
import { LangyPanelAccessService } from "./langy-panel-access.service.ts";
import type { OpenLangyTurnBuffer } from "./langy-turn-settlement-waiter.service.ts";
import { LangyTurnTailService } from "./langy-turn-tail.service.ts";
import type { LangyTurnsBoundsService } from "./langy-turns-bounds.service.ts";
import type { LangyUiActionPageService } from "./langy-ui-action-page.service.ts";
import type { LangyService } from "./langy.service.ts";

const logger = createLogger("langwatch:langy:panel");

/** Main's per-user budgets for the panel: sends, and the looser one a panel-open warm spends. */
const MESSAGES_PER_MINUTE = 30;
const WARMS_PER_MINUTE = 60;

type Frame = z.infer<typeof langyConversationUpdateFrameSchema>;

export type LangyPanelConversationMembers = Readonly<{
  access: LangyPanelAccessService;
  langy: Pick<
    LangyService,
    | "getPage"
    | "getEventsAfter"
    | "findByIdVisible"
    | "getById"
    | "getAllByConversation"
    | "shouldAskFeedback"
    | "markFeedbackShown"
    | "deleteById"
    | "updateById"
    | "forkById"
    | "startConversationTurn"
    | "stopTurn"
    | "warmConversationWorker"
    | "findModelsAllowedForProject"
  >;
  turnBounds: Pick<LangyTurnsBoundsService, "assertTurnWithinBounds">;
  rateLimiter: RateLimiter;
  presence: Pick<PresenceApi, "getTenantEmitter" | "cleanupTenantEmitter">;
  turnAccess: LangyTurnAccessRepository | null;
  openBuffer: OpenLangyTurnBuffer | null;
  /** Absent without Redis: no action is ever published, so no tab can claim or complete one. */
  uiActions: Pick<LangyUiActionPageService, "claim" | "complete"> | null;
}>;

/**
 * The panel's conversation procedures, each one main's `langy.*` handler moved here unchanged
 * behind the panel gate. Spec: modules/langy/specs/langy-panel-trpc.feature
 */
export class LangyPanelConversationService {
  static create(members: LangyPanelConversationMembers): LangyPanelConversationService {
    return new LangyPanelConversationService(members);
  }

  private constructor(private readonly members: LangyPanelConversationMembers) {}

  async listConversations(
    input: LangyPanelCall<typeof langyListInputSchema>,
  ): Promise<LangyConversationListPageDto> {
    await this.members.access.assertPanelAccess(input);
    const page = await this.members.langy.getPage({
      projectId: input.projectId,
      userId: input.caller.userId,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.query ? { query: input.query } : {}),
    });
    return { items: page.items.map(toListItemDto), nextCursor: page.nextCursor };
  }

  async getConversationEventsAfter(
    input: LangyPanelCall<typeof langyEventsAfterInputSchema>,
  ): Promise<LangyConversationEventPageDto> {
    await this.members.access.assertPanelAccess(input);
    return this.members.langy.getEventsAfter({
      projectId: input.projectId,
      conversationId: input.conversationId,
      userId: input.caller.userId,
      after: input.after,
    });
  }

  /** The open conversation's spine; empty while it is not visible or not projected yet. */
  /** The tab asking to run a published action; the conversation must be visible to it. */
  async claimUiAction(
    input: LangyPanelCall<typeof langyClaimUiActionInputSchema>,
  ): Promise<{ isClaimed: boolean }> {
    await this.members.access.assertPanelAccess(input);
    const { uiActions } = this.members;
    const conversation = await this.members.langy.findByIdVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    });
    if (!conversation || !uiActions) return { isClaimed: false };
    return uiActions.claim({
      projectId: input.projectId,
      userId: input.caller.userId,
      conversationId: input.conversationId,
      actionId: input.actionId,
    });
  }

  /** Only the claiming user may complete; anything else is dropped as not accepted. */
  async completeUiAction(
    input: LangyPanelCall<typeof langyCompleteUiActionInputSchema>,
  ): Promise<{ isAccepted: boolean }> {
    await this.members.access.assertPanelAccess(input);
    if (!this.members.uiActions) return { isAccepted: false };
    return this.members.uiActions.complete({
      projectId: input.projectId,
      userId: input.caller.userId,
      conversationId: input.conversationId,
      actionId: input.actionId,
      completion: {
        ok: input.ok,
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
    });
  }

  async findVisibleConversationDetails(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyConversationDetailDto[]> {
    await this.members.access.assertPanelAccess(input);
    const detail = await this.members.langy.findByIdVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    });
    return detail ? [toDetailDto(detail)] : [];
  }

  async getConversationMessages(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyConversationMessagesDto> {
    await this.members.access.assertPanelAccess(input);
    const scope = {
      conversationId: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    };
    const conversation = await this.members.langy.getById({ ...scope, id: input.conversationId });
    const rows = await this.members.langy.getAllByConversation(scope);
    const messages = rows.map((row) => ({
      id: row.id,
      role: langyMessageRoleSchema.catch("assistant").parse(row.role),
      parts: row.parts.filter(isPart),
      createdAtMs: row.createdAt.epochMilliseconds,
    }));
    const isTurnInFlight =
      conversation.status === LANGY_CONVERSATION_STATUS.ACTIVE ||
      conversation.status === LANGY_CONVERSATION_STATUS.RUNNING;
    const shouldAskFeedback = isTurnInFlight
      ? false
      : await this.members.langy.shouldAskFeedback({
          userId: input.caller.userId,
          conversationId: input.conversationId,
          assistantAnswerCount: messages.filter((message) => message.role === "assistant").length,
        });
    return {
      messages,
      lastError:
        conversation.status === LANGY_CONVERSATION_STATUS.FAILED ? conversation.lastError : null,
      isTurnInFlight,
      inFlightTurnId: isTurnInFlight ? conversation.currentTurnId : null,
      shouldAskFeedback,
      eventCursor: conversation.eventCursor,
      currentTurnId: isTurnInFlight ? conversation.currentTurnId : null,
      lastModel: conversation.lastModel,
    };
  }

  /** A shared conversation is visible but not the caller's to archive: `success: false`. */
  async archiveConversation(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ success: boolean }> {
    await this.members.access.assertPanelAccess(input);
    const success = await this.members.langy.deleteById({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    });
    return { success };
  }

  async renameConversation(
    input: LangyPanelCall<typeof langyRenameInputSchema>,
  ): Promise<LangyConversationDetailDto> {
    await this.members.access.assertPanelAccess(input);
    const detail = await this.members.langy.updateById({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
      title: input.title,
    });
    return toDetailDto(detail);
  }

  async forkConversation(
    input: LangyPanelCall<typeof langyForkInputSchema>,
  ): Promise<LangyConversationDetailDto> {
    await this.members.access.assertPanelAccess(input);
    const { conversation } = await this.members.langy.forkById({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    });
    return toDetailDto(conversation);
  }

  /** A named id is adopted, so the first message lands on the worker a panel-open warm booted. */
  createConversationTurn(
    input: LangyPanelCall<typeof langyPanelCreateConversationInputSchema>,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.startTurn(input, Boolean(input.conversationId));
  }

  continueConversationTurn(
    input: LangyPanelCall<typeof langyContinueConversationInputSchema>,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.startTurn(input, false);
  }

  /** Never throttled: a Stop must always land. Idempotent on a finished turn. */
  async stopPanelTurn(
    input: LangyPanelCall<typeof langyStopTurnPanelInputSchema>,
  ): Promise<{ stopped: boolean }> {
    await this.members.access.assertPanelAccess(input);
    await this.members.langy.stopTurn({
      projectId: input.projectId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      userId: input.caller.userId,
    });
    return { stopped: true };
  }

  /** Fire-and-forget for the panel: past the gate, every failure is a cold start. */
  async warmPanelWorker(
    input: LangyPanelCall<typeof langyWarmWorkerInputSchema>,
  ): Promise<{ conversationId: string | null; warmed: boolean }> {
    await this.members.access.assertPanelAccess(input);
    const cold = { conversationId: input.conversationId ?? null, warmed: false };
    try {
      const budget = await this.members.rateLimiter.check(
        `langy:rl:warm:${input.projectId}:${input.caller.userId}`,
        { requests: WARMS_PER_MINUTE, seconds: 60 },
      );
      if (!budget.allowed) {
        logger.warn(
          { projectId: input.projectId },
          "langy warm rate limited, cold start on first message",
        );
        return cold;
      }
      return await this.members.langy.warmConversationWorker({
        projectId: input.projectId,
        session: LangyPanelAccessService.sessionOf(input.caller),
        requestedConversationId: input.conversationId ?? null,
        ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      });
    } catch (error) {
      logger.warn(
        { error, projectId: input.projectId },
        "langy warmWorker mutation failed, cold start on first message",
      );
      return cold;
    }
  }

  async getModelsAllowed(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ modelsAllowed: string[] | null }> {
    await this.members.access.assertPanelAccess(input);
    return {
      modelsAllowed: await this.members.langy.findModelsAllowedForProject(input.projectId),
    };
  }

  /** Ids the caller cannot see are dropped, never attached, so feedback cannot be forged. */
  async recordFeedback(
    input: LangyPanelCall<typeof langyRecordFeedbackInputSchema>,
  ): Promise<void> {
    await this.members.access.assertPanelAccess(input);
    let conversationId = input.conversationId;
    if (conversationId && !(await this.isVisible({ ...input, conversationId }))) {
      logger.warn(
        { projectId: input.projectId, conversationId, userId: input.caller.userId },
        "dropping langy feedback ids for a conversation the caller cannot see",
      );
      conversationId = undefined;
    }
    logger.debug(
      {
        event: "langy_feedback",
        projectId: input.projectId,
        userId: input.caller.userId,
        conversationId,
        rating: input.rating,
        sentiment: input.sentiment,
        shareConversationConsent: input.shareConversationConsent ?? false,
        hasTrace: Boolean(conversationId && input.traceId),
      },
      "no product-analytics sink is composed: langy feedback is not recorded",
    );
  }

  /** Showing the card counts as asking; a conversation the caller cannot see is a no-op. */
  async markFeedbackPromptShown(
    input: LangyPanelCall<typeof langyFeedbackPromptShownInputSchema>,
  ): Promise<void> {
    await this.members.access.assertPanelAccess(input);
    if (!(await this.isVisible(input))) {
      logger.warn(
        {
          projectId: input.projectId,
          conversationId: input.conversationId,
          userId: input.caller.userId,
        },
        "dropping langy feedback-shown mark for a conversation the caller cannot see",
      );
      return;
    }
    await this.members.langy.markFeedbackShown({
      userId: input.caller.userId,
      conversationId: input.conversationId,
    });
  }

  /** The tenant's freshness signals, narrowed to conversations this person may see. */
  async *watchConversationUpdates(
    input: LangyPanelCall<typeof langyProjectInputSchema> & { signal?: AbortSignal },
  ): AsyncGenerator<Frame> {
    await this.members.access.assertPanelAccess(input);
    const emitter = this.members.presence.getTenantEmitter(input.projectId);
    try {
      for await (const payload of listen({
        emitter,
        event: "langy_conversation_updated",
        signal: input.signal,
      })) {
        const frame = langyConversationUpdateFrameSchema.safeParse(payload);
        if (
          !frame.success ||
          !isLangyConversationUpdateVisibleToUser({
            eventPayload: frame.data.event,
            userId: input.caller.userId,
          })
        ) {
          continue;
        }
        yield frame.data;
      }
    } finally {
      this.members.presence.cleanupTenantEmitter(input.projectId);
    }
  }

  /** One turn's live edge; "no such turn" and "not yours" answer the same not-found. */
  async *watchTurnStream(
    input: LangyPanelCall<typeof langyTurnStreamInputSchema> & { signal?: AbortSignal },
  ): AsyncGenerator<LangyStreamEntry> {
    await this.members.access.assertPanelAccess(input);
    const { projectId, conversationId, turnId } = input;
    const userId = input.caller.userId;
    if (!(await this.canWatchTurn({ projectId, conversationId, turnId, userId }))) {
      logger.warn(
        { projectId, conversationId, turnId, userId },
        "denied a langy turn-stream attach",
      );
      throw new LangyConversationNotFoundError(conversationId);
    }
    const watch = this.members.openBuffer?.() ?? null;
    if (!watch) return;

    const { buffer, release } = watch;
    yield* LangyTurnTailService.create().streamTurnEntries({
      conversationId,
      turnId,
      buffer,
      readHealth: () => this.readTurnHealth({ projectId, conversationId, turnId, userId, buffer }),
      signal: input.signal ?? new AbortController().signal,
      release,
      onAbandoned: ({ stalePolls }) =>
        logger.warn(
          { projectId, conversationId, turnId, stalePolls },
          "giving up a turn stream whose turn neither settled nor beat",
        ),
    });
  }

  private async startTurn(
    input:
      | LangyPanelCall<typeof langyContinueConversationInputSchema>
      | LangyPanelCall<typeof langyPanelCreateConversationInputSchema>,
    adoptConversationId: boolean,
  ): Promise<{ conversationId: string; turnId: string }> {
    await this.members.access.assertPanelAccess(input);
    const budget = await this.members.rateLimiter.check(
      `langy:rl:msg:${input.projectId}:${input.caller.userId}`,
      { requests: MESSAGES_PER_MINUTE, seconds: 60 },
    );
    if (!budget.allowed) throw new LangyRateLimitedError();

    const idempotencyKey = input.idempotencyKey ?? input.requestId;
    if (!idempotencyKey) {
      const message = "idempotencyKey is required.";
      throw new ValidationError(message, { meta: { message } });
    }
    await this.members.turnBounds.assertTurnWithinBounds({ projectId: input.projectId });

    return this.members.langy.startConversationTurn({
      projectId: input.projectId,
      idempotencyKey,
      session: LangyPanelAccessService.sessionOf(input.caller),
      requestedConversationId: input.conversationId ?? null,
      ...(adoptConversationId ? { adoptConversationId: true } : {}),
      messages: input.messages,
      ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      isRetry: input.trigger === "regenerate-message",
      turnContext: { pageContext: input.pageContext, skills: input.skills },
    });
  }

  private async isVisible(input: {
    caller: LangyPanelCaller;
    projectId: string;
    conversationId: string;
  }): Promise<boolean> {
    const conversation = await this.members.langy.findByIdVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    });
    return conversation !== null;
  }

  /** The turn's own actor first, so a just-started turn does not 404 before its fold lands. */
  private async canWatchTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<boolean> {
    if (this.members.turnAccess && (await this.members.turnAccess.isTurnActor(input))) {
      return true;
    }
    const conversation = await this.members.langy.findByIdVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
    });
    return conversation !== null;
  }

  /** One look at the fold and the heartbeat; a failed read says nothing about the turn. */
  private async readTurnHealth(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
    buffer: {
      liveness(a: { conversationId: string; turnId: string }): Promise<{ stale: boolean }>;
    };
  }): Promise<TurnHealth | null> {
    const [conversation, liveness] = await Promise.all([
      this.members.langy
        .getById({ id: input.conversationId, projectId: input.projectId, userId: input.userId })
        .catch(() => null),
      input.buffer
        .liveness({ conversationId: input.conversationId, turnId: input.turnId })
        .catch(() => null),
    ]);
    if (!conversation || !liveness) return null;
    return {
      isStale: liveness.stale,
      terminal:
        deriveSyntheticTerminal({
          status: conversation.status,
          lastError: conversation.lastError,
          heartbeatStale: liveness.stale,
        }) ?? null,
    };
  }
}

function toListItemDto(item: LangyConversationListItem): LangyConversationListItemDto {
  return {
    id: item.id,
    title: item.title,
    isShared: item.isShared,
    isOwn: item.isOwn,
    messageCount: item.messageCount,
    lastActivityAtMs: item.lastActivityAt.epochMilliseconds,
  };
}

/** The fold status is a free string column: an unexpected value reads as active. */
function toDetailDto(detail: LangyConversationDetail): LangyConversationDetailDto {
  return {
    ...toListItemDto(detail),
    status: langyConversationStatusSchema.catch("active").parse(detail.status),
  };
}

function isPart(part: unknown): part is Record<string, unknown> {
  return typeof part === "object" && part !== null && !Array.isArray(part);
}

/** Each emission's first argument, until the signal aborts; the listener is always removed. */
async function* listen(input: {
  emitter: ReturnType<PresenceApi["getTenantEmitter"]>;
  event: string;
  signal: AbortSignal | undefined;
}): AsyncGenerator<unknown> {
  const queued: unknown[] = [];
  let wake: (() => void) | null = null;
  const onEvent = (...args: unknown[]) => {
    queued.push(args[0]);
    wake?.();
  };
  const onAbort = () => wake?.();
  input.emitter.on(input.event, onEvent);
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!input.signal?.aborted) {
      const next = queued.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    input.emitter.off(input.event, onEvent);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
