import {
  type AppendStore,
  createTenantId,
  Deferred,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { NotFoundError } from "@langwatch/handled-error";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
  LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import type { LangyTitleGenerator } from "../../app/langy.members.ts";
import type { LangyWorker } from "../../channels/langy-worker.channel.ts";
import type { LangyAnalyticsEventProjectionRecord } from "../../eventing/langy-analytics-event.projection.ts";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
  type LangyConversationUpdateChannel,
} from "../../eventing/langy-conversation.subscriber.ts";
import {
  createGuidedOnboardingTurnFailedSubscriber,
  type GuidedOnboardingAnalytics,
  type GuidedOnboardingReader,
} from "../../eventing/langy-guided-onboarding-turn-failed.subscriber.ts";
import {
  createLocalConnectTurnSubscriber,
  type LocalConnectTurnPresence,
} from "../../eventing/langy-local-connect-turn.subscriber.ts";
import type { ControlTurnStarter } from "../../rules/langy-local-session-contract.rules.ts";
import { LangyConversationPipelineService } from "../../services/langy-conversation-pipeline.service.ts";
import type { LangySessionKeyService } from "../../services/langy-session-key.service.ts";
import { RedisLangyEffectRepository } from "./redis.langy-effect.repository.ts";
import type { LangyTokenBufferRedisRepository } from "./redis.langy-token-buffer.repository.ts";
import type { LangyTurnHandoffRedisRepository } from "./redis.langy-turn-handoff.repository.ts";

/** The two command senders this pipeline's own effects need back. */
export interface RedisLangyConversationRuntimeRepository {
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
  broadcast: LangyConversationUpdateChannel;
  /** Postgres-authoritative logical-send receipts and active-turn claims. */
  admissions: Pick<LangyTurnAdmissionCapability, "confirmAccepted" | "release">;
  buffer: Pick<LangyTokenBufferRedisRepository, "liveness" | "appendStatus" | "markError">;
  handoffStore: Pick<LangyTurnHandoffRedisRepository, "read" | "stash" | "isStopped">;
  worker: LangyWorker;
  titleGenerator: LangyTitleGenerator;
  sessionKeys: Pick<LangySessionKeyService, "mintForUser" | "revoke">;
  /** The folder's owed connect turn (ADR-129); presence is read at handle time. */
  localConnectTurn: { presence: () => LocalConnectTurnPresence; turns: ControlTurnStarter };
  /** Onboarding's answer for a project, and the sink its failed turns are tracked to. */
  guidedOnboarding: { reader: GuidedOnboardingReader; analytics: GuidedOnboardingAnalytics };
}

/**
 * Langy's conversation pipeline and the worker-facing capability that composes it. Langy writes its
 * low-latency operational projections directly to Postgres. `connectCommands` is the loop this
 * feature cannot close alone.
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

  private constructor(private readonly options: EventingLangyConversationAdapterOptions) {}

  buildProcessing(): ReturnType<LangyConversationPipelineService["build"]> {
    const options = this.options;
    const conversationStore = options.langyConversationProjectionStore;

    const effectPorts = RedisLangyEffectRepository.create({
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
      getById: async ({
        projectId,
        conversationId,
      }: {
        projectId: string;
        conversationId: string;
      }) => {
        const read = await conversationStore.get(conversationId, {
          tenantId: createTenantId(projectId),
          aggregateId: conversationId,
        });
        if (read.kind === "empty") {
          throw new NotFoundError(
            "langy_conversation_not_found",
            "Langy conversation",
            conversationId,
          );
        }
        const { projection } = read;
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
    const guidedOnboardingTurnFailedSubscriber = createGuidedOnboardingTurnFailedSubscriber({
      guidedOnboarding: options.guidedOnboarding.reader,
      conversations: conversationReader,
      analytics: options.guidedOnboarding.analytics,
    });
    const localConnectTurnSubscriber = createLocalConnectTurnSubscriber({
      presence: options.localConnectTurn.presence,
      conversations: conversationReader,
      turns: options.localConnectTurn.turns,
    });

    return LangyConversationPipelineService.create({
      langyConversationProjectionStore: conversationStore,
      langyConversationTurnProjectionStore: options.langyConversationTurnProjectionStore,
      langyMessageProjectionStore: options.langyMessageProjectionStore,
      langyAnalyticsEventProjectionStore: options.langyAnalyticsEventProjectionStore,
      langyProcessPorts: effectPorts,
      subscribers: [
        livenessSubscriber,
        broadcastSubscriber,
        admissionLifecycleSubscriber,
        guidedOnboardingTurnFailedSubscriber,
        localConnectTurnSubscriber,
      ],
    }).build();
  }

  connectCommands(commands: RedisLangyConversationRuntimeRepository): void {
    this.failTurn.resolve((args) =>
      commands.failAgentResponse({
        tenantId: args.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        conversationId: args.conversationId,
        turnId: args.turnId,
        error: args.error,
      }),
    );
    this.saveTitle.resolve((args) =>
      commands.generateConversationTitle({
        tenantId: args.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        conversationId: args.conversationId,
        turnId: args.turnId,
        title: args.title,
        source: "auto",
        model: args.model,
      }),
    );
  }
}
