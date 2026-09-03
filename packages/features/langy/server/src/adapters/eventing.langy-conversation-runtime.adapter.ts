import {
  type AppendStore,
  createTenantId,
  Deferred,
  type StateProjectionStore,
} from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
  LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";
import { LangyEffectPortsAdapter } from "./langy-effect.adapter";
import { createLangyConversationProcessingPipeline } from "./eventing.langy-conversation.adapter";
import type { LangyAnalyticsEventProjectionRecord } from "../projections/langy-analytics-event.projection";
import type { LangyTitleGenerator } from "../ports/langy-effect.port";
import type { LangyWorkerPort } from "../ports/langy-turn-runtime.port";
import type { LangySessionKeyService } from "../services/langy-session-key.service";
import type { LangyTokenBuffer } from "../streaming/langy-token-buffer";
import type { LangyTurnHandoffStore } from "../streaming/langy-turn-handoff";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
  type LangyBroadcastPort,
} from "../subscribers/langy-conversation.subscriber";

/** The two command senders this pipeline's own effects need back. */
export interface LangyConversationRuntimeCommands {
  failAgentResponse(data: {
    tenantId: string;
    occurredAt: number;
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void>;
  generateConversationTitle(data: {
    tenantId: string;
    occurredAt: number;
    conversationId: string;
    turnId: string;
    title: string;
    source: "auto";
    model: string;
  }): Promise<void>;
}

export interface EventingLangyConversationAdapterOptions {
  /** Direct Postgres operational projection; deliberately bypasses Redis. */
  langyConversationProjectionStore: StateProjectionStore<LangyConversationStateData>;
  /** Direct Postgres per-turn operational projection. */
  langyConversationTurnProjectionStore: StateProjectionStore<LangyConversationTurnData>;
  /** Postgres per-message operational projection. */
  langyMessageProjectionStore: AppendStore<LangyMessageProjectionRecord>;
  /** Content-free ClickHouse event-grain analytics. */
  langyAnalyticsEventProjectionStore: AppendStore<LangyAnalyticsEventProjectionRecord>;
  broadcast: LangyBroadcastPort;
  /** Postgres-authoritative logical-send receipts and active-turn claims. */
  admissions: Pick<LangyTurnAdmissionCapability, "confirmAccepted" | "release">;
  buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
  handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
  worker: LangyWorkerPort;
  titleGenerator: LangyTitleGenerator;
  sessionKeys: Pick<LangySessionKeyService, "mintForUser" | "revoke">;
}

/**
 * Langy's conversation pipeline and the worker-facing capability that
 * composes it. Langy writes its low-latency operational projections directly
 * to Postgres.
 *
 * `connectCommands` is the loop this feature cannot close alone. Two of the
 * pipeline's own effects append back into it — a permanently rejected dispatch
 * fails the turn, and a generated title is saved as an event — so the senders
 * they need are produced by the very registration that mounts them. Binding
 * them once, straight after registration, is what turns a mis-registered graph
 * into a boot failure instead of a turn that hangs.
 */
export class EventingLangyConversationAdapter {
  static create(
    options: EventingLangyConversationAdapterOptions,
  ): EventingLangyConversationAdapter {
    return new EventingLangyConversationAdapter(options);
  }

  private readonly failTurn = new Deferred<
    (args: {
      projectId: string;
      conversationId: string;
      turnId: string;
      error: string;
    }) => Promise<void>
  >("langyFailTurn");

  private readonly saveTitle = new Deferred<
    (args: {
      projectId: string;
      conversationId: string;
      turnId: string;
      title: string;
      model: string;
    }) => Promise<void>
  >("langyGenerateTitle");

  private constructor(
    private readonly options: EventingLangyConversationAdapterOptions,
  ) {}

  buildProcessing() {
    const options = this.options;
    const conversationStore = options.langyConversationProjectionStore;

    const effectPorts = LangyEffectPortsAdapter.create({
      handoffStore: options.handoffStore,
      worker: options.worker,
      mintSessionKey: ({ userId, projectId, organizationId }) =>
        options.sessionKeys.mintForUser({ userId, projectId, organizationId }),
      revokeSessionKey: ({ apiKeyId, projectId }) =>
        options.sessionKeys.revoke({ apiKeyId, projectId }),
      titleGenerator: options.titleGenerator,
      saveTitle: (args) => this.saveTitle.fn(args),
      failTurn: { failTurn: (args) => this.failTurn.fn(args) },
      markError: (args) => options.buffer.markError(args),
    });

    const conversationReader = {
      read: async ({
        projectId,
        conversationId,
      }: {
        projectId: string;
        conversationId: string;
      }) => {
        const projection = await conversationStore.tryLoad(conversationId, {
          tenantId: createTenantId(projectId),
          aggregateId: conversationId,
        });
        if (!projection) return null;
        return {
          cursor: projection.cursor,
          status: projection.state.Status,
          currentTurnId: projection.state.CurrentTurnId,
          lastActivityAtMs: projection.state.LastActivityAt,
          ownerUserId: projection.state.UserId,
          isShared: projection.state.IsShared,
        };
      },
    };

    const livenessSubscriber = createAgentTurnLivenessSubscriber({
      buffer: options.buffer,
      conversations: conversationReader,
      failTurn: { failTurn: (args) => this.failTurn.fn(args) },
      worker: options.worker,
      handoffStore: options.handoffStore,
    });
    const broadcastSubscriber = createLangyConversationUpdateBroadcastSubscriber({
      broadcast: options.broadcast,
      conversations: conversationReader,
    });
    const admissionLifecycleSubscriber = createLangyTurnAdmissionLifecycleSubscriber({
      admissions: options.admissions,
    });

    return createLangyConversationProcessingPipeline({
      langyConversationProjectionStore: conversationStore,
      langyConversationTurnProjectionStore: options.langyConversationTurnProjectionStore,
      langyMessageProjectionStore: options.langyMessageProjectionStore,
      langyAnalyticsEventProjectionStore: options.langyAnalyticsEventProjectionStore,
      langyProcessPorts: effectPorts,
      subscribers: [livenessSubscriber, broadcastSubscriber, admissionLifecycleSubscriber],
    });
  }

  connectCommands(commands: LangyConversationRuntimeCommands): void {
    this.failTurn.resolve((args) =>
      commands.failAgentResponse({
        tenantId: args.projectId,
        occurredAt: Date.now(),
        conversationId: args.conversationId,
        turnId: args.turnId,
        error: args.error,
      }),
    );
    this.saveTitle.resolve((args) =>
      commands.generateConversationTitle({
        tenantId: args.projectId,
        occurredAt: Date.now(),
        conversationId: args.conversationId,
        turnId: args.turnId,
        title: args.title,
        source: "auto",
        model: args.model,
      }),
    );
  }
}
