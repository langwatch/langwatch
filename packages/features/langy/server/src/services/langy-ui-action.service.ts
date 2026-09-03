import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import {
  LangyUiActionUnknownError,
  LangyUiHandlerFailedError,
  LangyUiNoBrowserError,
  LangyUiPayloadInvalidError,
  LangyUiTimeoutError,
  LangyUiTurnInactiveError,
} from "@langwatch/langy-contract";
import type { LangyTokenBuffer } from "../streaming/langy-token-buffer";
import type {
  LangyUiActionCatalogPort,
  LangyUiActionDefinition,
} from "../ports/langy-ui-action-catalog.port";

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
/**
 * Hard ceiling on any execute budget.
 *
 * The dispatch blocks a `langwatch ui call`, and that command runs inside an
 * agent worker whose harness stops any command at 30 seconds. A ceiling at 30
 * seconds was therefore a race the CLI always lost: the harness killed it at
 * the same instant the server gave up, so the caller never read the CLI's
 * "the action may still have applied" warning, which is written for exactly
 * that case.
 *
 * The ceiling is the WHOLE server wait, claim window included: the dispatch
 * waits the claim window first, then the rest of the budget, so a 15s ceiling
 * is 3s of claim plus at most 12s of execute.
 *
 * The order that has to hold is: this ceiling (15s) < the CLI's own request
 * deadline (20s, sdks/typescript/src/cli/commands/ui/call.ts) < the harness
 * stop (30s), so the failure is always reported by the layer that owns it.
 * This still clears the ingress idle timeout.
 */
export const UI_ACTION_MAX_BUDGET_MS = 15_000;
/** Pending records outlive the longest possible dispatch, then self-clean. */
const PENDING_TTL_SECONDS = 60;
const CLAIM_TTL_SECONDS = 60;
const RESULT_TTL_SECONDS = 30;
/** A page result bigger than this is a bug, not a payload. */
const MAX_RESULT_BYTES = 64 * 1024;
/**
 * What the dispatch writes into the claim key when it takes the action for the
 * backend. It is not a user id, so a page can never complete against it.
 */
const BACKEND_CLAIMANT = "langy:backend";

const logger = createLogger("langwatch:langy:ui-actions");

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
  definition: LangyUiActionDefinition;
  payload: unknown;
  experimentSlug?: string;
}) => Promise<unknown>;

/** The minimal Redis surface the service needs (ioredis satisfies it). */
export interface UiActionRedis {
  set(key: string, value: string, mode: "EX", ttl: number, nx?: "NX"): Promise<unknown>;
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
  private readonly actions: LangyUiActionCatalogPort;
  private readonly backendRunner?: UiActionBackendRunner;

  constructor(deps: {
    redis: UiActionRedis;
    conversations: UiActionConversations;
    buffer: Pick<LangyTokenBuffer, "appendUiAction">;
    /**
     * Which kinds exist and what each one's payload must look like.
     *
     * A port rather than an import: the only catalogue that exists is the
     * experiments workbench's, and a Langy server package may not reach into
     * another feature's. The process that holds both supplies it; a process
     * that holds neither composes none, and `dispatch` refuses every kind by
     * name — which is the right answer there, because no page on it can run one.
     */
    actions: LangyUiActionCatalogPort;
    backendRunner?: UiActionBackendRunner;
  }) {
    this.redis = deps.redis;
    this.conversations = deps.conversations;
    this.buffer = deps.buffer;
    this.actions = deps.actions;
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

    const definition = this.actions.tryFind(kind);
    if (!definition) throw new LangyUiActionUnknownError(kind);

    const parsed = definition.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new LangyUiPayloadInvalidError(kind, parsed.error.issues);
    }

    // Always publish and let the claim window decide whether a page is
    // attached. Presence looked like a cheaper answer, but its heartbeat is
    // mounted per view (today only traces-v2), so on every other page
    // "presence enabled, zero sessions" is the permanent state and a
    // pre-check on it sent EVERY action to the backend with an open tab
    // right there. The claim window costs three seconds only when nobody is
    // home, which is the rare case for an agent driving a page the user
    // asked it to drive.
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

  private async runOnBackend({
    actionId,
    kind,
    definition,
    payload,
    experimentSlug,
    remainingMs,
  }: {
    actionId: string;
    kind: string;
    definition: LangyUiActionDefinition;
    payload: unknown;
    experimentSlug?: string;
    /** What is left of the ceiling once the claim window is spent. */
    remainingMs: number;
  }): Promise<UiActionOutcome> {
    if (!this.backendRunner) throw new LangyUiNoBrowserError(kind);
    // The backend answers under the same ceiling the page does. Without this
    // the runner is awaited unbounded, so a slow action runs past the ceiling
    // and the CLI's deadline reports the failure instead of this layer.
    //
    // The action is not cancelled, only stopped being waited on: it may still
    // apply, which is exactly what the caller is told.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LangyUiTimeoutError(kind)), remainingMs);
    });
    let result: unknown;
    try {
      result = await Promise.race([
        this.backendRunner({ kind, definition, payload, experimentSlug }),
        deadline,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
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
   * Two-stage wait on the result list. Stage one covers the claim window: a
   * result OR a claim must appear inside it, else the page counts as away and
   * the dispatch takes the claim key for the backend, which is what makes the
   * handover atomic (see the take below). Stage two waits out the action's own
   * execute budget once something claimed it; a claimed but silent page is a
   * timeout, never a re-dispatch, because the page may have half-applied the
   * action.
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
      if (first) return this.toOutcome({ actionId, kind, raw: first[1] });

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
          CLAIM_TTL_SECONDS,
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
          kind,
          definition,
          payload,
          experimentSlug,
          remainingMs,
        });
      }

      const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      const second = await blocking.blpop(uiActionKeys.result(actionId), remainingSeconds);
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
   * other tab, every stream replay, and a tab racing the dispatch's own
   * handover to the backend gets `isClaimed: false` and drops. The pending
   * record is the authority on WHERE the action belongs: a claim naming a
   * different conversation or project than the dispatch pinned is refused
   * exactly like an unknown action, so this cannot be used to probe or hijack
   * another dispatch. The claim value records the executing user for
   * `complete`.
   *
   * WHICH TURN is deliberately not part of that test. The dispatch takes the
   * turn from a projection the event log writes after the fact, while the page
   * holds the id its own send returned; for as long as those disagree, a page
   * open in front of the user could not claim anything and every action went to
   * the backend instead, which is how a live-driven workbench turned into a
   * page that only caught up at the end. The project, the conversation and the
   * caller's session already answer every question a turn id would.
   */
  async claim({
    projectId,
    userId,
    conversationId,
    actionId,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
  }): Promise<{ isClaimed: boolean }> {
    const pending = await this.readPending(actionId);
    if (!pending || pending.projectId !== projectId || pending.conversationId !== conversationId) {
      return { isClaimed: false };
    }
    const set = await this.redis.set(
      uiActionKeys.claim(actionId),
      userId,
      "EX",
      CLAIM_TTL_SECONDS,
      "NX",
    );
    return { isClaimed: set === "OK" };
  }

  /**
   * The page reporting the claimed action's outcome. Only the claiming user's
   * session may complete, and only while the pending record still names the
   * same project and conversation; anything else is dropped as
   * `isAccepted: false` (the dispatch side has its own timeout, so a dropped
   * completion cannot wedge it).
   */
  async complete({
    projectId,
    userId,
    conversationId,
    actionId,
    completion,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
    completion: UiActionCompletion;
  }): Promise<{ isAccepted: boolean }> {
    const pending = await this.readPending(actionId);
    if (!pending || pending.projectId !== projectId || pending.conversationId !== conversationId) {
      return { isAccepted: false };
    }
    const claimant = await this.redis.get(uiActionKeys.claim(actionId));
    if (claimant !== userId) return { isAccepted: false };

    const raw = JSON.stringify(completion);
    // Measure what Redis stores: a string's length counts UTF-16 code units,
    // so a result of multi-byte characters passes a length check at up to
    // three times the ceiling.
    if (Buffer.byteLength(raw, "utf8") > MAX_RESULT_BYTES) {
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
    return { isAccepted: true };
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
