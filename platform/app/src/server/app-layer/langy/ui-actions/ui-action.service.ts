import { nanoid } from "nanoid";
import type { LangyTokenBuffer } from "../streaming/langyTokenBuffer";
import {
  LangyUiActionUnknownError,
  LangyUiHandlerFailedError,
  LangyUiNoBrowserError,
  LangyUiPayloadInvalidError,
  LangyUiTimeoutError,
  LangyUiTurnInactiveError,
} from "./errors";
import { findPageAction } from "./pageManifests";

/**
 * The agent-to-page action channel (specs/langy/langy-ui-actions.feature).
 *
 * One dispatch is one blocking HTTP call from the `langwatch ui call` CLI
 * command running inside the worker: the service validates the action, pins it
 * to the conversation's ACTIVE turn in Redis, publishes it on that turn's live
 * stream (the channel the panel is already tailing mid-turn, exactly like
 * `navigate`), and then waits on a Redis list for the page's result. The
 * browser claims the action (SET NX, so two tabs execute it at most once),
 * runs the page-registered handler, and reports back through the
 * `claimUiAction` / `completeUiAction` tRPC mutations, which land the result
 * on the list this dispatch is blocked on.
 *
 * Security pins, in order: the ROUTE authenticates the session key and
 * enforces the action's own permission ceiling before calling dispatch; the
 * conversation lookup here proves the conversation belongs to the key's
 * owning user and project (a foreign id dies as not-found, never confirming
 * existence); the pending record written here is what claim/complete verify
 * against, so a claim or completion can never attach to a different turn,
 * conversation, or project than the dispatch named.
 */

/** How long the page has to CLAIM a published action before it counts as away. */
export const UI_ACTION_CLAIM_WINDOW_MS = 3_000;
/** Execute budget when the action's manifest declares none. */
export const UI_ACTION_DEFAULT_BUDGET_MS = 10_000;
/** Hard ceiling on any execute budget, under the ingress idle timeout. */
export const UI_ACTION_MAX_BUDGET_MS = 30_000;
/** Pending records outlive the longest possible dispatch, then self-clean. */
const PENDING_TTL_SECONDS = 60;
const CLAIM_TTL_SECONDS = 60;
const RESULT_TTL_SECONDS = 30;
/** A page result bigger than this is a bug, not a payload. */
const MAX_RESULT_BYTES = 64 * 1024;

export const uiActionKeys = {
  pending: (actionId: string) => `langy:ui:pending:${actionId}`,
  claim: (actionId: string) => `langy:ui:claim:${actionId}`,
  result: (actionId: string) => `langy:ui:result:${actionId}`,
};

/** What the pending record pins: where the action belongs. */
interface PendingUiAction {
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
  kind: string;
  definition: NonNullable<ReturnType<typeof findPageAction>>;
  payload: unknown;
  experimentSlug?: string;
}) => Promise<unknown>;

/** The one presence read dispatch uses: is any of this project's tabs alive? */
export interface UiActionPresence {
  isEnabledForProject(projectId: string): Promise<boolean>;
  getByProject(projectId: string): Promise<unknown[]>;
}

/** The minimal Redis surface the service needs (ioredis satisfies it). */
export interface UiActionRedis {
  set(
    key: string,
    value: string,
    mode: "EX",
    ttl: number,
    nx?: "NX",
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  lpush(key: string, value: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  /** ioredis duplicate — a dedicated connection for the blocking wait. */
  duplicate(): UiActionBlockingRedis;
}

export interface UiActionBlockingRedis {
  blpop(key: string, timeoutSeconds: number): Promise<[string, string] | null>;
  disconnect(): void;
}

/** The one slice of the conversation service dispatch needs. */
export interface UiActionConversations {
  findByIdVisible(args: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ currentTurnId: string | null } | null>;
}

export class LangyUiActionService {
  private readonly redis: UiActionRedis;
  private readonly conversations: UiActionConversations;
  private readonly buffer: Pick<LangyTokenBuffer, "appendUiAction">;
  private readonly presence?: UiActionPresence;
  private readonly backendRunner?: UiActionBackendRunner;

  constructor(deps: {
    redis: UiActionRedis;
    conversations: UiActionConversations;
    buffer: Pick<LangyTokenBuffer, "appendUiAction">;
    presence?: UiActionPresence;
    backendRunner?: UiActionBackendRunner;
  }) {
    this.redis = deps.redis;
    this.conversations = deps.conversations;
    this.buffer = deps.buffer;
    this.presence = deps.presence;
    this.backendRunner = deps.backendRunner;
  }

  /**
   * Dispatch one action to the page attached to `conversationId`'s active turn
   * and block until its result arrives, the claim window lapses, or the
   * execute budget runs out. Throws typed errors for every refusal; the caller
   * (the route) has already enforced the action's permission ceiling.
   *
   * `notFound` is thrown by the caller-supplied factory so the route can reuse
   * its own not-found error without this module importing the conversation
   * error family.
   */
  async dispatch({
    projectId,
    userId,
    conversationId,
    kind,
    payload,
    experimentSlug,
    notFound,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    kind: string;
    payload: unknown;
    experimentSlug?: string;
    notFound: () => Error;
  }): Promise<UiActionOutcome> {
    const conversation = await this.conversations.findByIdVisible({
      id: conversationId,
      projectId,
      userId,
    });
    if (!conversation) throw notFound();

    const turnId = conversation.currentTurnId;
    if (!turnId) throw new LangyUiTurnInactiveError();

    const definition = findPageAction(kind);
    if (!definition) throw new LangyUiActionUnknownError(kind);

    const parsed = definition.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new LangyUiPayloadInvalidError(kind, parsed.error.issues);
    }

    // Nobody's home? Skip the publish entirely and apply the action to the
    // saved state. Presence is a pre-check only: unavailable or disabled
    // presence means "unknown", and the claim window below decides instead.
    if (await this.projectHasNoLiveTab(projectId)) {
      const actionId = nanoid();
      return await this.runOnBackend({
        actionId,
        kind,
        definition,
        payload: parsed.data,
        experimentSlug,
      });
    }

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

    return await this.awaitResult({
      actionId,
      kind,
      definition,
      payload: parsed.data,
      experimentSlug,
    });
  }

  /**
   * True only when presence is available, enabled for the project, and
   * reports zero live sessions. Any uncertainty answers false, so the claim
   * window stays the deciding signal.
   */
  private async projectHasNoLiveTab(projectId: string): Promise<boolean> {
    if (!this.presence || !this.backendRunner) return false;
    try {
      if (!(await this.presence.isEnabledForProject(projectId))) return false;
      const sessions = await this.presence.getByProject(projectId);
      return sessions.length === 0;
    } catch {
      return false;
    }
  }

  private async runOnBackend({
    actionId,
    kind,
    definition,
    payload,
    experimentSlug,
  }: {
    actionId: string;
    kind: string;
    definition: NonNullable<ReturnType<typeof findPageAction>>;
    payload: unknown;
    experimentSlug?: string;
  }): Promise<UiActionOutcome> {
    if (!this.backendRunner) throw new LangyUiNoBrowserError(kind);
    const result = await this.backendRunner({
      kind,
      definition,
      payload,
      experimentSlug,
    });
    return {
      status: "done",
      executedVia: "backend",
      actionId,
      kind,
      result: result ?? null,
    };
  }

  /**
   * Two-stage wait on the result list. Stage one covers the claim window: a
   * result OR a claim must appear inside it, else the page counts as away and
   * the pending record is deleted FIRST, so a zombie tab claiming late finds
   * nothing and drops (no double execution — see `claim`). Stage two waits out
   * the action's own execute budget once something claimed it; a claimed but
   * silent page is a timeout, never a re-dispatch, because the page may have
   * half-applied the action.
   */
  private async awaitResult({
    actionId,
    kind,
    definition,
    payload,
    experimentSlug,
  }: {
    actionId: string;
    kind: string;
    definition: NonNullable<ReturnType<typeof findPageAction>>;
    payload: unknown;
    experimentSlug?: string;
  }): Promise<UiActionOutcome> {
    const blocking = this.redis.duplicate();
    try {
      const claimWindowSeconds = Math.ceil(UI_ACTION_CLAIM_WINDOW_MS / 1000);
      const first = await blocking.blpop(
        uiActionKeys.result(actionId),
        claimWindowSeconds,
      );
      if (first) return this.toOutcome({ actionId, kind, raw: first[1] });

      const claimed = await this.redis.get(uiActionKeys.claim(actionId));
      if (!claimed) {
        // Nothing is listening. Delete the pending record before deciding, so
        // a tab that wakes up later cannot claim and execute an action whose
        // dispatch already answered — the backend execution below must stay
        // the only execution.
        await this.redis.del(uiActionKeys.pending(actionId));
        return await this.runOnBackend({
          actionId,
          kind,
          definition,
          payload,
          experimentSlug,
        });
      }

      const budgetMs = Math.min(
        definition.executeBudgetMs ?? UI_ACTION_DEFAULT_BUDGET_MS,
        UI_ACTION_MAX_BUDGET_MS,
      );
      const remainingSeconds = Math.max(
        1,
        Math.ceil((budgetMs - UI_ACTION_CLAIM_WINDOW_MS) / 1000),
      );
      const second = await blocking.blpop(
        uiActionKeys.result(actionId),
        remainingSeconds,
      );
      if (second) return this.toOutcome({ actionId, kind, raw: second[1] });

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

  /**
   * The page asking to execute `actionId`. First caller wins (SET NX); every
   * other tab, and every stream replay, gets `claimed: false` and drops. The
   * pending record is the authority: a claim naming a different turn,
   * conversation, or project than the dispatch pinned is refused exactly like
   * an unknown action, so this cannot be used to probe or hijack another
   * dispatch. The claim value records the executing user for `complete`.
   */
  async claim({
    projectId,
    userId,
    conversationId,
    turnId,
    actionId,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    turnId: string;
    actionId: string;
  }): Promise<{ claimed: boolean }> {
    const pending = await this.readPending(actionId);
    if (
      !pending ||
      pending.projectId !== projectId ||
      pending.conversationId !== conversationId ||
      pending.turnId !== turnId
    ) {
      return { claimed: false };
    }
    const set = await this.redis.set(
      uiActionKeys.claim(actionId),
      userId,
      "EX",
      CLAIM_TTL_SECONDS,
      "NX",
    );
    return { claimed: set === "OK" };
  }

  /**
   * The page reporting the claimed action's outcome. Only the claiming user's
   * session may complete, and only while the pending record still pins the
   * same turn; anything else is dropped as `accepted: false` (the dispatch
   * side has its own timeout, so a dropped completion cannot wedge it).
   */
  async complete({
    projectId,
    userId,
    conversationId,
    turnId,
    actionId,
    completion,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    turnId: string;
    actionId: string;
    completion: UiActionCompletion;
  }): Promise<{ accepted: boolean }> {
    const pending = await this.readPending(actionId);
    if (
      !pending ||
      pending.projectId !== projectId ||
      pending.conversationId !== conversationId ||
      pending.turnId !== turnId
    ) {
      return { accepted: false };
    }
    const claimant = await this.redis.get(uiActionKeys.claim(actionId));
    if (claimant !== userId) return { accepted: false };

    const raw = JSON.stringify(completion);
    if (raw.length > MAX_RESULT_BYTES) {
      await this.redis.lpush(
        uiActionKeys.result(actionId),
        JSON.stringify({
          ok: false,
          errorCode: "result_too_large",
        } satisfies UiActionCompletion),
      );
    } else {
      await this.redis.lpush(uiActionKeys.result(actionId), raw);
    }
    await this.redis.expire(uiActionKeys.result(actionId), RESULT_TTL_SECONDS);
    await this.redis.del(uiActionKeys.pending(actionId));
    return { accepted: true };
  }

  private async readPending(actionId: string): Promise<PendingUiAction | null> {
    const raw = await this.redis.get(uiActionKeys.pending(actionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingUiAction;
    } catch {
      return null;
    }
  }
}
