/**
 * The Langy feature's application: what its doors call.
 *
 * It holds every service and process capability the feature's api files reach,
 * and it is the one typed thing a transport is given. Before it, the
 * conversation door declared `Readonly<{ langy; redis; broadcast }>` and the
 * egress door declared `Readonly<{ langy }>` — two descriptions of the same
 * composition, agreeing by attention rather than by construction, and neither
 * reachable from the other.
 *
 * Most operations are `LangyService`'s own, delegated straight through. What
 * lives here as a rule of its own is what a door would otherwise have to
 * decide for itself:
 *
 *   - who may watch a turn's live stream, which reads the Redis turn-access
 *     record AND the durable visibility rule and must never widen either;
 *   - whether the caller can see a conversation at all before a side effect is
 *     attributed to it — three handlers ran that check for themselves;
 *   - the turn-start operation create and continue share, including the
 *     `requestId` wire alias, which is one rule two procedures used;
 *   - that a null egress allow-list means monitor-only, which both egress
 *     procedures shaped separately.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import { HandledError, ValidationError } from "@langwatch/handled-error";
import {
  LangyConversationNotFoundError,
  type LangyConversationDetail,
  type LangyConversationEventPage,
  type LangyConversationListCursor,
  type LangyConversationListPage,
  type LangyCredentialSession,
  type LangyEgressAllowlist,
  type LangyEventCursor,
  type LangyMessageRow,
  type LangyService,
} from "@langwatch/langy-contract";
import type { LangyChatMessageInput } from "../services/langy-turn.shared";
import { LangyTokenBuffer, type LangyStreamEntry } from "../streaming/langy-token-buffer";
import { LangyTurnAccessStore } from "../streaming/langy-turn-access";
import { decideSyntheticTerminal } from "../streaming/langy-turn-settlement";
import { abortableDelay } from "../streaming/langy-turn-settlement-waiter";
import { SETTLEMENT_CONFIRM_POLLS, SETTLEMENT_POLL_MS } from "../streaming/langy-turn-tail";

/**
 * The Redis surface the live-turn edge needs: the turn-access record a
 * just-started turn's actor is read from, and a dedicated connection for the
 * blocking tail. An ioredis standalone or cluster client satisfies it.
 */
export type LangyRedis = Readonly<{
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  duplicate(): { disconnect(): void };
}>;

/** The read side of the process's broadcast fabric. */
export type LangyBroadcast = Readonly<{
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
}>;

/**
 * No credential session behind an otherwise authenticated caller.
 *
 * A turn mints this user's worker credentials from the session, so refusing is
 * the only safe answer: a session synthesized from the actor id alone would
 * provision credentials under an incomplete user. `unauthorized` rather than a
 * Langy-specific code because the cause and the remedy are the platform's own
 * — the registry's copy for it already says "you're not signed in, sign in
 * again", which is exactly the action available. 401, which is the status the
 * bare `TRPCError({ code: "UNAUTHORIZED" })` this replaces already answered;
 * what changes is that the refusal now arrives with `data.error` populated,
 * so the client's explainer can tell it from an internal crash.
 */
export class LangySessionRequiredError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "No active session for this Langy request.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "LangySessionRequiredError";
  }
}

/** What the process composes this feature's application from. */
export interface LangyAppDependencies {
  langy: LangyService;
  /** Absent in a deployment without Redis; the live edge degrades to the fold. */
  redis: LangyRedis | null;
  broadcast: LangyBroadcast;
}

/** The project's egress allow-list, told the way both egress procedures tell it. */
export interface LangyEgressState {
  allowlist: LangyEgressAllowlist;
  /** `false` is monitor-only: watch, never block. */
  enforcing: boolean;
}

/** One live turn's durable buffer, plus the connection it borrowed. */
export interface LangyTurnStream {
  buffer: LangyTokenBuffer;
  /** Releases the dedicated blocking connection. Always call it. */
  close(): void;
}

/** What a turn-start asks for, before the caller's session is attached. */
export interface LangyTurnRequest {
  projectId: string;
  idempotencyKey?: string | undefined;
  /** @deprecated wire alias for pre-rename client bundles — same semantics. */
  requestId?: string | undefined;
  conversationId?: string | null | undefined;
  messages: LangyChatMessageInput[];
  modelOverride?: string | undefined;
  trigger?: "submit-message" | "regenerate-message" | "resume-stream" | undefined;
  /** The composer's page context and skills, bounded and sanitised downstream. */
  turnContext: object;
}

export class LangyApp {
  static create(dependencies: LangyAppDependencies): LangyApp {
    return new LangyApp(dependencies);
  }

  private constructor(private readonly dependencies: LangyAppDependencies) {}

  /**
   * The service itself, for the paths that are not a Langy door.
   *
   * Everything below serves a person looking at a conversation. These do not:
   * the worker posts its turn result back over `/api/internal/langy`
   * (`turnExists`, `ingestAgentTurnResult`, `revokeWorkerSessionKey`), the
   * frame relay opens a long-lived ndjson connection (`openRelayConnection`),
   * and the wait path on the public HTTP turn API takes a `LangyService` as a
   * parameter. Each runs against a worker session key rather than a person, so
   * modelling them here would put the agent's own callbacks in the same surface
   * as the panel's reads. Until they move, this getter is the seam that
   * remains — the same one `WorkflowApp.workflowService` keeps.
   */
  get langyService(): LangyService {
    return this.dependencies.langy;
  }

  // -- conversation reads ----------------------------------------------------

  /** One page of the caller's slim conversation spine. */
  listPage(input: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationListPage> {
    return this.dependencies.langy.getPage(input);
  }

  /** The conversation's durable turn events strictly after a cursor. */
  eventsAfter(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: LangyEventCursor;
  }): Promise<LangyConversationEventPage> {
    return this.dependencies.langy.getEventsAfter(input);
  }

  /**
   * The conversation, or null when it is not visible to this caller.
   *
   * Absence is a real answer here: a freshness poll of a just-started
   * conversation runs before its fold is projected, so the throwing form would
   * fail every first turn.
   */
  tryFindVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail | null> {
    return this.dependencies.langy.tryFindByIdVisible(input);
  }

  /**
   * Whether this caller may attribute a side effect to this conversation.
   *
   * Lifted out of `claimUiAction`, `recordFeedback` and `feedbackPromptShown`,
   * which each ran the same visible-read and each decided for themselves what
   * absence meant. It is one rule — never act on a conversation id the caller
   * cannot see — and three copies of it is three chances to widen it.
   */
  async isVisibleToCaller(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    return (await this.dependencies.langy.tryFindByIdVisible(input)) !== null;
  }

  /** The conversation spine, raising the feature's not-found when it is not visible. */
  getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail> {
    return this.dependencies.langy.getById(input);
  }

  /** The conversation's stored message history. */
  messages(input: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<LangyMessageRow[]> {
    return this.dependencies.langy.getAllByConversation(input);
  }

  /** Whether the panel should ask for feedback under the latest answer. */
  shouldAskFeedback(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean> {
    return this.dependencies.langy.shouldAskFeedback(input);
  }

  /** Starts the quiet period: showing the feedback card counts as asking. */
  markFeedbackShown(input: { userId: string; conversationId: string }): Promise<void> {
    return this.dependencies.langy.markFeedbackShown(input);
  }

  /** The model allow-list the composer narrows to, or null when every model is allowed. */
  tryGetModelsAllowed(projectId: string): Promise<string[] | null> {
    return this.dependencies.langy.tryGetModelsAllowedForProject(projectId);
  }

  // -- conversation writes ---------------------------------------------------

  /** Archives a conversation the caller owns. A shared one reports `false`. */
  deleteConversation(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    return this.dependencies.langy.deleteById(input);
  }

  /**
   * Renames a conversation the caller owns.
   *
   * The service already raises the same typed not-found for "no such
   * conversation" and "not yours" (deliberately indistinguishable), so the
   * null branch is unreachable in practice. It stays because the service's
   * declared return permits null and a silent `undefined` would be worse than
   * a redundant refusal — and it lives here so one door cannot keep it while
   * another forgets it.
   */
  async renameConversation(input: {
    id: string;
    projectId: string;
    userId: string;
    title: string;
  }): Promise<LangyConversationDetail> {
    const detail = await this.dependencies.langy.updateById(input);
    if (!detail) throw new LangyConversationNotFoundError(input.id);
    return detail;
  }

  /** Branches a visible conversation into a private, independently editable one. */
  async forkConversation(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail> {
    const { conversation } = await this.dependencies.langy.forkById(input);
    return conversation;
  }

  /** Records the durable stopped terminal for an in-flight turn. Idempotent. */
  stopTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<void> {
    return this.dependencies.langy.stopTurn(input);
  }

  /**
   * Starts a turn for the caller's session.
   *
   * Create and continue are the SAME operation — `adoptConversationId` is the
   * only difference, and it is what lets a first message land on the
   * conversation a panel-open warm already booted a worker for. Both
   * procedures used to call one module-private helper here; putting it on the
   * application is what stops a second door writing a second copy of the
   * `requestId` alias rule, whose whole job is to keep pre-rename client
   * bundles working.
   */
  startTurn(
    input: LangyTurnRequest,
    session: LangyCredentialSession,
    options: Readonly<{ adoptConversationId?: boolean }> = {},
  ): Promise<{ conversationId: string; turnId: string }> {
    // Imperative rather than a schema `.refine`: the procedures carry a
    // projectId input and tRPC merges `.input()` calls, which requires plain
    // object schemas rather than the effects a refine produces.
    const idempotencyKey = input.idempotencyKey ?? input.requestId;
    if (!idempotencyKey) {
      const message = "idempotencyKey is required.";
      // `meta.message` is the channel that survives serialize() (ADR-045) —
      // the HandledError's own `message` is not put on the wire.
      throw new ValidationError(message, { meta: { message } });
    }
    return this.dependencies.langy.startConversationTurn({
      projectId: input.projectId,
      idempotencyKey,
      session,
      requestedConversationId: input.conversationId ?? null,
      ...(options.adoptConversationId ? { adoptConversationId: true } : {}),
      messages: input.messages,
      ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      isRetry: input.trigger === "regenerate-message",
      turnContext: input.turnContext,
    });
  }

  /** Pre-boots the conversation's worker before the first message. */
  warmWorker(input: {
    projectId: string;
    session: LangyCredentialSession;
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    return this.dependencies.langy.warmConversationWorker(input);
  }

  // -- the project's egress allow-list ---------------------------------------

  /**
   * The project's egress allow-list and whether it is enforced.
   *
   * `null` from the service means monitor-only — watch, never block. Both
   * egress procedures translated that null for themselves, which is one rule
   * written twice about a network policy.
   */
  async egressAllowlist(input: { projectId: string }): Promise<LangyEgressState> {
    return toEgressState(await this.dependencies.langy.tryGetEgressAllowlist(input));
  }

  /** Replaces the allow-list. An empty list clears it back to monitor-only. */
  async setEgressAllowlist(input: {
    projectId: string;
    allowlist: LangyEgressAllowlist;
  }): Promise<LangyEgressState> {
    return toEgressState(await this.dependencies.langy.trySetEgressAllowlist(input));
  }

  // -- the live edge ---------------------------------------------------------

  /** The tenant's conversation-update signals. */
  conversationUpdates(projectId: string): NodeJS.EventEmitter {
    return this.dependencies.broadcast.getTenantEmitter(projectId);
  }

  /** Releases the tenant emitter this subscription borrowed. */
  releaseConversationUpdates(projectId: string): void {
    this.dependencies.broadcast.cleanupTenantEmitter(projectId);
  }

  /**
   * May this caller watch this turn's live stream?
   *
   * The fast path confirms the turn's own actor from the synchronously-written
   * turn-access record, so a just-started turn does not report not-found
   * before its fold is projected; otherwise it falls back to the durable
   * visibility rule (owner or shared). It never widens access — and it reads
   * BOTH the Redis record and the service, which is exactly why no door should
   * hold the two halves itself.
   */
  async canWatchTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<boolean> {
    const { projectId, conversationId, turnId, userId } = input;
    const { redis, langy } = this.dependencies;
    if (redis) {
      const access = LangyTurnAccessStore.create({ redis });
      if (await access.isTurnActor({ projectId, conversationId, turnId, userId })) {
        return true;
      }
    }
    const conversation = await langy.tryFindByIdVisible({
      id: conversationId,
      projectId,
      userId,
    });
    return !!conversation;
  }

  /**
   * The durable token buffer for one turn, with its own blocking connection.
   *
   * Null when the deployment has no Redis: there is then no live buffer and
   * the client falls back to the Postgres conversation/message read.
   */
  tryOpenTurnStream(): LangyTurnStream | null {
    const connection = this.dependencies.redis;
    if (!connection) return null;
    const blocking = connection.duplicate();
    return {
      buffer: LangyTokenBuffer.create({ redis: connection, blockingRedis: blocking }),
      close: () => blocking.disconnect(),
    };
  }

  /**
   * Polls the durable fold and the per-turn heartbeat while the live edge is
   * tailed, and answers with the terminal to synthesize once the turn has
   * settled without one — or null if it never does.
   *
   * A refresh mid-turn can miss the worker's terminal frame, and the follow
   * would then block until the hard per-turn deadline while the UI sits on a
   * startup status for minutes though the turn already finished.
   */
  async watchForMissedTerminal(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
    buffer: {
      liveness(a: { conversationId: string; turnId: string }): Promise<{ stale: boolean }>;
    };
    signal: AbortSignal;
  }): Promise<LangyStreamEntry | null> {
    const { projectId, conversationId, turnId, userId, buffer, signal } = input;
    let settledStreak = 0;
    while (!signal.aborted) {
      if (!(await abortableDelay(SETTLEMENT_POLL_MS, signal))) return null;
      const [conversation, liveness] = await Promise.all([
        this.dependencies.langy
          .getById({ id: conversationId, projectId, userId })
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
}

function toEgressState(allowlist: LangyEgressAllowlist | null): LangyEgressState {
  return { allowlist: allowlist ?? [], enforcing: allowlist !== null };
}
