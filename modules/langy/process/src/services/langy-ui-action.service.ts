import {
  LangyUiHandlerFailedError,
  LangyUiNoBrowserError,
  LangyUiPayloadInvalidError,
  LangyUiTimeoutError,
  LangyUiTurnInactiveError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";

import type { LangyUiActionCatalog, LangyUiActionDefinition } from "../app/langy.members.ts";
import type {
  LangyStreamRedis,
  LangyTokenBufferRepository,
} from "../repositories/langy-token-buffer.repository.ts";

/**
 * The agent-to-page action channel (specs/langy/langy-ui-actions.feature).
 */

/** How long the page has to CLAIM a published action before it counts as away. */
export const UI_ACTION_CLAIM_WINDOW_MS = 3_000;
/** Execute budget when the action's manifest declares none. */
export const UI_ACTION_DEFAULT_BUDGET_MS = 10_000;
/**
 * Hard ceiling on any execute budget. The dispatch blocks a `langwatch ui call`, and that command
 * runs inside an agent worker whose harness stops any command at 30 seconds.
 */
export const UI_ACTION_MAX_BUDGET_MS = 15_000;
/** Pending records outlive the longest possible dispatch, then self-clean. */
const PENDING_TTL_SECONDS = 60;
export const UI_ACTION_CLAIM_TTL_SECONDS = 60;
/**
 * What the dispatch writes into the claim key when it takes the action for the
 * backend. It is not a user id, so a page can never complete against it.
 */
const BACKEND_CLAIMANT = "langy:backend";

const logger = createLogger("langwatch:langy:ui-actions");

export const uiActionKeys = {
  pending: (actionId: string): string => `langy:ui:pending:${actionId}`,
  claim: (actionId: string): string => `langy:ui:claim:${actionId}`,
  result: (actionId: string): string => `langy:ui:result:${actionId}`,
};

/** What the pending record pins: where the action belongs. */
export interface PendingUiAction {
  projectId: string;
  conversationId: string;
  turnId: string;
  kind: string;
}

/** What the page reports back through `completeUiAction`. */
export interface UiActionCompletion {
  ok: boolean;
  result?: unknown;
  errorCode?: string;
}

/** The dispatch answer the CLI prints for the agent. */
export interface UiActionOutcome {
  status: "done";
  executedVia: "browser" | "backend";
  actionId: string;
  kind: string;
  result: unknown;
}

/**
 * The away-fallback executor: the same action applied to the SAVED state.
 * Injected so the service stays testable and free of the execution pipeline.
 */
export type UiActionBackendRunner = (args: {
  /** The tenant the saved document belongs to. */
  projectId: string;
  /** Who the edit is recorded as: the dispatching agent's own user. */
  userId: string;
  kind: string;
  definition: LangyUiActionDefinition;
  payload: unknown;
  experimentSlug?: string;
}) => Promise<unknown>;

/** The minimal Redis surface the service needs (ioredis satisfies it). */
export type UiActionRedis = LangyStreamRedis &
  Pick<Redis, "del" | "lpush"> & {
    /** ioredis duplicate — a dedicated connection for the blocking wait. */
    duplicate(): UiActionBlockingRedis;
  };

export type UiActionBlockingRedis = Pick<Redis, "blpop" | "disconnect">;

/** The one slice of the conversation service dispatch needs. */
export interface UiActionConversations {
  /** Throws `LangyConversationNotFoundError` when the conversation is missing or not visible. */
  getById(args: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ currentTurnId: string | null }>;
}

/** Everything the UI-action channel needs from the process that holds it. */
export type LangyUiActionServiceDependencies = {
  redis: UiActionRedis;
  conversations: UiActionConversations;
  buffer: Pick<LangyTokenBufferRepository, "appendUiAction">;
  /**
   * Which kinds exist and what each one's payload must look like. A port rather than an import: the
   * only catalogue that exists is the experiments workbench's, and a Langy server package may not
   * reach into another feature's.
   */
  actions: LangyUiActionCatalog;
  backendRunner?: UiActionBackendRunner;
};

export class LangyUiActionService {
  static create(deps: LangyUiActionServiceDependencies): LangyUiActionService {
    return new LangyUiActionService(deps);
  }

  private readonly redis: UiActionRedis;
  private readonly conversations: UiActionConversations;
  private readonly buffer: Pick<LangyTokenBufferRepository, "appendUiAction">;
  private readonly actions: LangyUiActionCatalog;
  private readonly backendRunner?: UiActionBackendRunner;

  private constructor(deps: LangyUiActionServiceDependencies) {
    this.redis = deps.redis;
    this.conversations = deps.conversations;
    this.buffer = deps.buffer;
    this.actions = deps.actions;
    this.backendRunner = deps.backendRunner;
  }

  /**
   * Dispatch one action to the page attached to `conversationId`'s active turn and block until its
   * result arrives, the claim window lapses, or the execute budget runs out. Throws typed errors
   * for every refusal; the caller (the route) has already enforced the action's permission ceiling.
   */
  async dispatch({
    projectId,
    userId,
    conversationId,
    kind,
    payload,
    experimentSlug,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    kind: string;
    payload: unknown;
    experimentSlug?: string;
  }): Promise<UiActionOutcome> {
    const conversation = await this.conversations.getById({
      id: conversationId,
      projectId,
      userId,
    });

    const turnId = conversation.currentTurnId;
    if (!turnId) {
      throw new LangyUiTurnInactiveError();
    }

    const definition = this.actions.getByKind(kind);

    const parsed = definition.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new LangyUiPayloadInvalidError(kind, parsed.error.issues);
    }

    // Always publish and let the claim window decide whether a page is attached. Presence looked
    // like a cheaper answer, but its heartbeat is mounted per view (today only traces-v2), so on
    // every other page "presence enabled, zero sessions" is the permanent state and a pre-check on
    // it sent EVERY action to the backend with an open tab right there.
    const actionId = nanoid();
    const pending: PendingUiAction = {
      projectId,
      conversationId,
      turnId,
      kind,
    };
    await this.redis.set(
      uiActionKeys.pending(actionId),
      JSON.stringify(pending),
      "EX",
      PENDING_TTL_SECONDS,
    );

    await this.buffer.appendUiAction({
      conversationId,
      turnId,
      actionId,
      kind,
      payload: parsed.data,
    });

    return this.awaitResult({
      actionId,
      projectId,
      userId,
      kind,
      definition,
      payload: parsed.data,
      experimentSlug,
    });
  }

  private async runOnBackend({
    actionId,
    projectId,
    userId,
    kind,
    definition,
    payload,
    experimentSlug,
    remainingMs,
  }: {
    actionId: string;
    projectId: string;
    userId: string;
    kind: string;
    definition: LangyUiActionDefinition;
    payload: unknown;
    experimentSlug?: string;
    /** What is left of the ceiling once the claim window is spent. */
    remainingMs: number;
  }): Promise<UiActionOutcome> {
    if (!this.backendRunner) {
      throw new LangyUiNoBrowserError(kind);
    }

    // The backend answers under the same ceiling the page does. Without this the runner is awaited
    // unbounded, so a slow action runs past the ceiling and the CLI's deadline reports the failure
    // instead of this layer. The action is not cancelled, only stopped being waited on: it may
    // still apply, which is exactly what the caller is told.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LangyUiTimeoutError(kind)), remainingMs);
    });
    let result: unknown;
    try {
      result = await Promise.race([
        this.backendRunner({ projectId, userId, kind, definition, payload, experimentSlug }),
        deadline,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    return {
      status: "done",
      executedVia: "backend",
      actionId,
      kind,
      result: result ?? null,
    };
  }

  /**
   * Two-stage wait on the result list. Stage one covers the claim window: a result OR a claim must
   * appear inside it, else the page counts as away and the dispatch takes the claim key for the
   * backend, which is what makes the handover atomic (see the take below).
   */
  private async awaitResult({
    actionId,
    projectId,
    userId,
    kind,
    definition,
    payload,
    experimentSlug,
  }: {
    actionId: string;
    projectId: string;
    userId: string;
    kind: string;
    definition: LangyUiActionDefinition;
    payload: unknown;
    experimentSlug?: string;
  }): Promise<UiActionOutcome> {
    const blocking = this.redis.duplicate();
    // What is left of the ceiling once the claim window is spent. Both the
    // page and the backend answer inside it, so the whole server wait stays
    // under the CLI's own deadline whichever side runs the action.
    const budgetMs = Math.min(
      definition.executeBudgetMs ?? UI_ACTION_DEFAULT_BUDGET_MS,
      UI_ACTION_MAX_BUDGET_MS,
    );
    const remainingMs = Math.max(1_000, budgetMs - UI_ACTION_CLAIM_WINDOW_MS);
    try {
      const claimWindowSeconds = Math.ceil(UI_ACTION_CLAIM_WINDOW_MS / 1000);
      const first = await blocking.blpop(uiActionKeys.result(actionId), claimWindowSeconds);
      if (first) {
        return this.toOutcome({ actionId, kind, raw: first[1] });
      }

      // Take the claim key for the backend with the same SET NX a page uses:
      // both sides then contend for one key, so exactly one of them can win.
      // Only reading the key here would leave a window where a tab that has
      // already validated the pending record claims right after the dispatch
      // decided, and the page and the backend both run the action.
      const isClaimedForBackend =
        (await this.redis.set(
          uiActionKeys.claim(actionId),
          BACKEND_CLAIMANT,
          "EX",
          UI_ACTION_CLAIM_TTL_SECONDS,
          "NX",
        )) === "OK";
      if (isClaimedForBackend) {
        // Which path an action took decides what the user sees: the page runs
        // it in front of them, the backend runs it out of sight and the page
        // catches up at the end. That difference was invisible in the logs, so
        // a channel silently falling back for every write read as a design
        // choice rather than the fault it was.
        logger.info(
          { actionId, kind, claimWindowMs: UI_ACTION_CLAIM_WINDOW_MS },
          "no page claimed the ui action, running it on the backend",
        );
        // Nothing is listening, and no page can claim now. Drop the pending
        // record so a zombie tab finds nothing left to validate either.
        await this.redis.del(uiActionKeys.pending(actionId));

        return await this.runOnBackend({
          actionId,
          projectId,
          userId,
          kind,
          definition,
          payload,
          experimentSlug,
          remainingMs,
        });
      }

      const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      const second = await blocking.blpop(uiActionKeys.result(actionId), remainingSeconds);
      if (second) {
        return this.toOutcome({ actionId, kind, raw: second[1] });
      }

      await this.redis.del(uiActionKeys.pending(actionId));

      throw new LangyUiTimeoutError(kind);
    } finally {
      blocking.disconnect();
    }
  }

  private toOutcome({
    actionId,
    kind,
    raw,
  }: {
    actionId: string;
    kind: string;
    raw: string;
  }): UiActionOutcome {
    let completion: UiActionCompletion;
    try {
      completion = JSON.parse(raw) as UiActionCompletion;
    } catch {
      throw new LangyUiHandlerFailedError(kind);
    }

    if (!completion.ok) {
      throw new LangyUiHandlerFailedError(kind, completion.errorCode);
    }

    return {
      status: "done",
      executedVia: "browser",
      actionId,
      kind,
      result: completion.result ?? null,
    };
  }
}
