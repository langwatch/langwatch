/**
 * The Langy feature's application: what its doors call. It holds every service and process
 * capability the feature's api files reach, and it is the one typed thing a transport is given.
 */
import { ValidationError } from "@langwatch/handled-error";
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
  type LangyLocalRecord,
  type LangyMessagePart,
  type LangyMessageRole,
  type LangyStreamEntry,
  LangyApi,
  type LangyApi as LangyApiContract,
  langyServerConfigSchema,
  type LangyServerConfig,
} from "@langwatch/langy-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { LangyChatMessageInput } from "../services/langy-turn-shared.service.ts";

import type { LangyTokenBufferPort } from "../repositories/langy-token-buffer.repository.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { decideSyntheticTerminal } from "../rules/langy-turn-settlement.rules.ts";
import { LangyTurnSettlementWaiterService } from "../services/langy-turn-settlement-waiter.service.ts";
import {
  SETTLEMENT_CONFIRM_POLLS,
  SETTLEMENT_POLL_MS,
} from "../services/langy-turn-tail.service.ts";
import {
  PostgresLangyAdapter,
  type LangyServiceCompositionOptions,
  type PostgresLangyAdapterOptions,
} from "../adapters/langy.langy.adapter.ts";

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

export type LangyInfrastructure = Readonly<
  PostgresLangyAdapterOptions &
    LangyServiceCompositionOptions & {
      redis: LangyRedis | null;
      broadcast: LangyBroadcast;
    }
>;

/** The read side of the process's broadcast fabric. */
export type LangyBroadcast = Readonly<{
  getTenantEmitter(tenantId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(tenantId: string): void;
}>;

/** What the process composes this feature's application from. */
type LangyAppDependencies = {
  langy: LangyApiContract;
  /** The rows the module keeps outside its event log, chosen at boot. */
  repositories: LangyRepositories;
  /** Absent in a deployment without Redis; the live edge degrades to the fold. */
  redis: LangyRedis | null;
  broadcast: LangyBroadcast;
};

/** The project's egress allow-list, told the way both egress procedures tell it. */
export interface LangyEgressState {
  allowlist: LangyEgressAllowlist;
  /** `false` is monitor-only: watch, never block. */
  enforcing: boolean;
}

/** One live turn's durable buffer, plus the connection it borrowed. */
export interface LangyTurnStream {
  buffer: LangyTokenBufferPort;
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

type LangySetup = FeatureSetup<
  Record<never, never>,
  LangyInfrastructure,
  LangyServerConfig,
  LangyRepositories
>;

export class LangyApp implements LangyApiContract {
  static readonly contract: typeof LangyApi = LangyApi;
  static readonly dependencies: Record<never, never> = {};
  static readonly configSchema = langyServerConfigSchema;

  static create(setup: LangySetup): LangyApp {
    const adapter = PostgresLangyAdapter.create({ database: setup.infrastructure.database });
    const langy = adapter.build({
      turns: setup.infrastructure.turns,
      credentials: setup.infrastructure.credentials,
      commands: setup.infrastructure.commands,
      events: setup.infrastructure.events,
      runtime: setup.infrastructure.runtime,
      relay: setup.infrastructure.relay,
      feedbackPromptRedis: setup.infrastructure.feedbackPromptRedis,
      blockMetrics: setup.infrastructure.blockMetrics,
    });
    return new LangyApp({
      langy,
      repositories: setup.repositories,
      redis: setup.infrastructure.redis,
      broadcast: setup.infrastructure.broadcast,
    });
  }

  private constructor(private readonly dependencies: LangyAppDependencies) {}

  /** The rows this application persists outside its own event log. */
  get repositories(): LangyRepositories {
    return this.dependencies.repositories;
  }

  /**
   * The service itself, for the paths that are not a Langy door. Everything below serves a
   * person looking at a conversation.
   */
  get langyService(): LangyApiContract {
    return this.dependencies.langy;
  }

  findEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null> {
    return this.dependencies.langy.findEgressAllowlist(input);
  }

  trySetEgressAllowlist(input: {
    projectId: string;
    allowlist: LangyEgressAllowlist;
  }): Promise<LangyEgressAllowlist | null> {
    return this.dependencies.langy.trySetEgressAllowlist(input);
  }

  openRelayConnection() {
    return this.dependencies.langy.openRelayConnection();
  }

  getPage(input: Parameters<LangyApiContract["getPage"]>[0]) {
    return this.dependencies.langy.getPage(input);
  }

  getEventsAfter(input: Parameters<LangyApiContract["getEventsAfter"]>[0]) {
    return this.dependencies.langy.getEventsAfter(input);
  }

  findByIdVisible(input: Parameters<LangyApiContract["findByIdVisible"]>[0]) {
    return this.dependencies.langy.findByIdVisible(input);
  }

  getAllByConversation(input: Parameters<LangyApiContract["getAllByConversation"]>[0]) {
    return this.dependencies.langy.getAllByConversation(input);
  }

  deleteById(input: Parameters<LangyApiContract["deleteById"]>[0]) {
    return this.dependencies.langy.deleteById(input);
  }

  updateById(input: Parameters<LangyApiContract["updateById"]>[0]) {
    return this.dependencies.langy.updateById(input);
  }

  forkById(input: Parameters<LangyApiContract["forkById"]>[0]) {
    return this.dependencies.langy.forkById(input);
  }

  startConversationTurn(input: Parameters<LangyApiContract["startConversationTurn"]>[0]) {
    return this.dependencies.langy.startConversationTurn(input);
  }

  warmConversationWorker(input: Parameters<LangyApiContract["warmConversationWorker"]>[0]) {
    return this.dependencies.langy.warmConversationWorker(input);
  }

  findModelsAllowedForProject(projectId: string) {
    return this.dependencies.langy.findModelsAllowedForProject(projectId);
  }

  revokeWorkerSessionKey(input: Parameters<LangyApiContract["revokeWorkerSessionKey"]>[0]) {
    return this.dependencies.langy.revokeWorkerSessionKey(input);
  }

  turnExists(input: Parameters<LangyApiContract["turnExists"]>[0]) {
    return this.dependencies.langy.turnExists(input);
  }

  ingestAgentTurnResult(input: Parameters<LangyApiContract["ingestAgentTurnResult"]>[0]) {
    return this.dependencies.langy.ingestAgentTurnResult(input);
  }

  findRunToken(input: Parameters<LangyApiContract["findRunToken"]>[0]) {
    return this.dependencies.langy.findRunToken(input);
  }

  recordToolCallStarted(input: Parameters<LangyApiContract["recordToolCallStarted"]>[0]) {
    return this.dependencies.langy.recordToolCallStarted(input);
  }

  recordToolCallCompleted(input: Parameters<LangyApiContract["recordToolCallCompleted"]>[0]) {
    return this.dependencies.langy.recordToolCallCompleted(input);
  }

  recordTurnHandoff(input: Parameters<LangyApiContract["recordTurnHandoff"]>[0]) {
    return this.dependencies.langy.recordTurnHandoff(input);
  }

  recordPlanUpdated(input: Parameters<LangyApiContract["recordPlanUpdated"]>[0]) {
    return this.dependencies.langy.recordPlanUpdated(input);
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
   * The conversation, or null when it is not visible to this caller. Absence is a real answer
   * here: a freshness poll of a just-started conversation runs before its fold is projected, so
   * the throwing form would fail every first turn.
   */
  tryFindVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail | null> {
    return this.dependencies.langy.findByIdVisible(input);
  }

  /**
   * Every card and connection state for one conversation, off the durable
   * record (ADR-129) — the live stream can't answer either for an adopted tab.
   */
  /** Writes one line into the transcript without starting a turn (ADR-129). */
  recordUserMessage(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: LangyMessagePart[];
    role?: LangyMessageRole;
  }): Promise<{ messageId: string }> {
    return this.dependencies.langy.recordUserMessage(input);
  }

  getLocalRecord(input: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<LangyLocalRecord> {
    return this.dependencies.langy.getLocalRecord(input);
  }

  /**
   * Whether this caller may attribute a side effect to this conversation. Lifted out of
   * `claimUiAction`, `recordFeedback` and `feedbackPromptShown`, which each ran the same
   * visible-read and each decided for themselves what absence meant.
   */
  async isVisibleToCaller(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    return (await this.dependencies.langy.findByIdVisible(input)) !== null;
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
  findModelsAllowed(projectId: string): Promise<string[] | null> {
    return this.dependencies.langy.findModelsAllowedForProject(projectId);
  }

  // -- conversation writes ---------------------------------------------------

  /** Archives a conversation the caller owns. A shared one reports `false`. */
  deleteConversation(input: { id: string; projectId: string; userId: string }): Promise<boolean> {
    return this.dependencies.langy.deleteById(input);
  }

  /**
   * Renames a conversation the caller owns. The service already raises the same typed not-found
   * for "no such conversation" and "not yours" (deliberately indistinguishable), so the null
   * branch is unreachable in practice.
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
   * Starts a turn for the caller's session. Create and continue are the SAME operation —
   * `adoptConversationId` is the only difference, and it is what lets a first message land on
   * the conversation a panel-open warm already booted a worker for.
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
   * The project's egress allow-list and whether it is enforced. `null` from the service means
   * monitor-only — watch, never block. Both egress procedures translated that null for
   * themselves, which is one rule written twice about a network policy.
   */
  async egressAllowlist(input: { projectId: string }): Promise<LangyEgressState> {
    return toEgressState(await this.dependencies.langy.findEgressAllowlist(input));
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
   */
  async canWatchTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<boolean> {
    const { projectId, conversationId, turnId, userId } = input;
    const { redis, langy, repositories } = this.dependencies;
    if (redis && (await repositories.turnAccess.isTurnActor({
      projectId,
      conversationId,
      turnId,
      userId,
    }))) {
      return true;
    }
    const conversation = await langy.findByIdVisible({
      id: conversationId,
      projectId,
      userId,
    });
    return !!conversation;
  }

  /**
   * The durable token buffer for one turn, with its own blocking connection. Null when the
   * deployment has no Redis: there is then no live buffer and the client falls back to the
   * Postgres conversation/message read.
   */
  tryOpenTurnStream(): LangyTurnStream | null {
    const connection = this.dependencies.redis;
    if (!connection) return null;
    const blocking = connection.duplicate();
    return {
      buffer: this.dependencies.repositories.tokenBuffer.open({
        redis: connection,
        blockingRedis: blocking,
      }),
      close: () => blocking.disconnect(),
    };
  }

  /**
   * Polls the durable fold and the per-turn heartbeat while the live edge is tailed, and
   * answers with the terminal to synthesize once the turn has settled without one — or null if
   * it never does.
   */
  async tryWatchForMissedTerminal(input: {
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
      if (!(await LangyTurnSettlementWaiterService.abortableDelay(SETTLEMENT_POLL_MS, signal)))
        return null;
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
