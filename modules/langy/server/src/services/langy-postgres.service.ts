import type { AppendStore, StateProjectionStore } from "@langwatch/eventing";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
  LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";
import {
  LangyService,
  type LangyConversationCommands,
  type LangyConversationEventsReader,
  type LangyConversationRuntime,
} from "./langy.service.ts";
import { RedisLangyTurnRelayRepository, type LangyRelayRedis } from "../repositories/redis/redis.langy-turn-relay.repository.ts";
import { LangyFeedbackPromptPolicy } from "./langy-feedback-prompt.service.ts";
import type { LangyFeedbackPromptRedis } from "../app/langy.infrastructure.ts";
import { LangyConversationService } from "./langy-conversation.service.ts";
import { LangyMessageService } from "./langy-message.service.ts";
import { LangyFinalPartsService } from "./langy-final-parts.service.ts";
import { LangyBlockMetrics } from "../app/langy.infrastructure.ts";
import { NullLangyBlockMetricsAdapter } from "./langy-block-metrics-null.service.ts";
import { PrismaLangyConversationRepository } from "../repositories/prisma/prisma.langy-conversation.repository.ts";
import { PrismaLangyMessageRepository } from "../repositories/prisma/prisma.langy-message.repository.ts";
import { PrismaLangyCredentialRepository } from "../repositories/prisma/prisma.langy-credential.repository.ts";
import { PrismaLangyTurnAdmissionRepository } from "../repositories/prisma/prisma.langy-turn-admission.repository.ts";
import type { LangyDatabase } from "../repositories/prisma/langy-database.mapper.ts";
import { PrismaLangyConversationProjectionRepository } from "../repositories/prisma/prisma.langy-conversation-projection.repository.ts";
import { PrismaLangyConversationTurnProjectionRepository } from "../repositories/prisma/prisma.langy-conversation-turn-projection.repository.ts";
import { PrismaLangyMessageProjectionRepository } from "../repositories/prisma/prisma.langy-message-projection.repository.ts";
import { LangyCredentialService } from "./langy-credential.service.ts";
import type {
  LangyCredentialErrorReporter,
  LangyCredentialRuntimeService,
  LangyGithubService,
  LangySessionKeyMintingService,
  LangyVirtualKeyService,
} from "./langy-credential.service.ts";
import type { LangySessionKeyMetrics } from "../app/langy.infrastructure.ts";
import { LangySessionKeyService } from "./langy-session-key.service.ts";
import { PrismaLangySessionKeyRepository } from "../repositories/prisma/prisma.langy-session-key.repository.ts";
import { LangyTurnService, type LangyTurnTechnicalMembers } from "./langy-turn.service.ts";

export abstract class LangyTrustedMessage {
  abstract getRecordsByConversation(input: { conversationId: string; projectId: string }): Promise<
    Array<{
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      content: string;
    }>
  >;
}

/** Application-owned technical credential adapters; the repository remains private. */
export type LangyCredentialComposition = {
  sessionKeys: LangySessionKeyMintingService;
  virtualKeys: LangyVirtualKeyService;
  github: LangyGithubService;
  runtime: LangyCredentialRuntimeService;
  errors?: LangyCredentialErrorReporter;
};

/** Generic capabilities needed before the Langy command pipeline is bound. */
export class LangyEventingMembers {
  constructor(
    readonly langyConversationState: StateProjectionStore<LangyConversationStateData>,
    readonly langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>,
    readonly langyMessageStorage: AppendStore<LangyMessageProjectionRecord>,
    readonly langyTurnAdmission: LangyTurnAdmissionCapability,
    readonly trustedMessages: LangyTrustedMessage,
  ) {}
}

/** How this process's Langy relay reaches Redis, and what it resolves for the agent. */
export type LangyRelayCompositionOptions = {
  redis: LangyRelayRedis;
  baseHost: string;
  resolveResourceUrl?: (input: { projectId: string; resourceId: string }) => Promise<string | null>;
  resolveCapabilityProgress?: (name: string) => { headline: string } | null;
  logger?: {
    warn(o: unknown, message: string): void;
    debug?(o: unknown, message: string): void;
  };
};

export type LangyServiceCompositionOptions = {
  turns: LangyTurnTechnicalMembers;
  credentials: LangyCredentialComposition;
  commands: LangyConversationCommands;
  events?: LangyConversationEventsReader | null;
  runtime?: LangyConversationRuntime;
  relay?: LangyRelayCompositionOptions;
  feedbackPromptRedis?: LangyFeedbackPromptRedis | null;
  /** The block-salvage counter. Absent composes `NullLangyBlockMetricsAdapter`: nothing published. */
  blockMetrics?: LangyBlockMetrics;
};

export interface PostgresLangyAdapterOptions {
  database: LangyDatabase;
}

interface LangyRepositories {
  conversations: PrismaLangyConversationRepository;
  messages: PrismaLangyMessageRepository;
  credentials: PrismaLangyCredentialRepository;
  admission: PrismaLangyTurnAdmissionRepository;
  conversationState: PrismaLangyConversationProjectionRepository;
  conversationTurnState: PrismaLangyConversationTurnProjectionRepository;
  messageStorage: PrismaLangyMessageProjectionRepository;
  sessionKeys: PrismaLangySessionKeyRepository;
}

/** Composes the Langy capability graph while keeping persistence private. */
export class PostgresLangyAdapter {
  private readonly repositories: LangyRepositories;
  private readonly eventingCapabilities: LangyEventingMembers;
  private service: LangyService | null = null;
  private sessionKeys: LangySessionKeyService | null = null;

  private constructor(options: PostgresLangyAdapterOptions) {
    this.repositories = {
      conversations: PrismaLangyConversationRepository.create(options.database),
      messages: PrismaLangyMessageRepository.create(options.database),
      credentials: PrismaLangyCredentialRepository.create(options.database),
      admission: PrismaLangyTurnAdmissionRepository.create(options.database),
      conversationState: PrismaLangyConversationProjectionRepository.create(options.database),
      conversationTurnState: PrismaLangyConversationTurnProjectionRepository.create(
        options.database,
      ),
      messageStorage: PrismaLangyMessageProjectionRepository.create(options.database),
      sessionKeys: PrismaLangySessionKeyRepository.create(options.database),
    };
    this.eventingCapabilities = new LangyEventingMembers(
      this.repositories.conversationState,
      this.repositories.conversationTurnState,
      this.repositories.messageStorage,
      this.repositories.admission,
      LangyMessageService.createTrustedMessageReader(this.repositories.messages),
    );
  }

  static create(options: PostgresLangyAdapterOptions): PostgresLangyAdapter {
    return new PostgresLangyAdapter(options);
  }

  /**
   * Returns stable generic stores for PipelineRegistry. No concrete Prisma
   * repository appears in this return type or crosses the feature boundary.
   */
  eventing(): LangyEventingMembers {
    return this.eventingCapabilities;
  }

  createSessionKeys(input: {
    apiKeys: ApiKeyApi;
    authz: AuthzService;
    metrics: LangySessionKeyMetrics;
  }): LangySessionKeyService {
    if (!this.sessionKeys) {
      this.sessionKeys = LangySessionKeyService.create({
        repository: this.repositories.sessionKeys,
        ...input,
      });
    }
    return this.sessionKeys;
  }

  /**
   * Builds the one application Langy service after commands are available.
   * Repeated calls return the same service and never construct repositories or
   * service graphs again.
   */
  build(options: LangyServiceCompositionOptions): LangyService {
    if (this.service) return this.service;

    const conversations = LangyConversationService.create(
      options.commands,
      this.repositories.conversations,
      this.repositories.messages,
      options.events,
      LangyFinalPartsService.create(
        (options.blockMetrics ?? NullLangyBlockMetricsAdapter.create()).blockCounter(),
      ),
      options.runtime,
    );
    const messages = LangyMessageService.create(
      this.repositories.messages,
      this.repositories.conversations,
    );
    const credentials = LangyCredentialService.create({
      repository: this.repositories.credentials,
      ...options.credentials,
    });

    const turns = LangyTurnService.create({
      ...options.turns,
      conversations,
      credentials,
      messages: this.repositories.messages,
      admission: this.repositories.admission,
    });
    const relay = options.relay;
    this.service = LangyService.create({
      conversations,
      turns,
      messages,
      credentials,
      feedbackPrompt: LangyFeedbackPromptPolicy.create({
        redis: options.feedbackPromptRedis ?? null,
      }),
      ...(relay
        ? {
            openRelay: (langyService) =>
              RedisLangyTurnRelayRepository.create({
                conversations: langyService,
                redis: relay.redis,
                baseHost: relay.baseHost,
                ...(relay.resolveResourceUrl
                  ? { resolveResourceUrl: relay.resolveResourceUrl }
                  : {}),
                ...(relay.resolveCapabilityProgress
                  ? { resolveCapabilityProgress: relay.resolveCapabilityProgress }
                  : {}),
                ...(relay.logger ? { logger: relay.logger } : {}),
              }),
          }
        : {}),
    });
    return this.service;
  }
}
