import type { AppendStore, StateProjectionStore } from "@langwatch/eventing";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type {
  LangyConversationStateData,
  LangyConversationTurnCapability,
  LangyConversationTurnData,
  LangyCredentialTurnCapability,
  LangyMessagePart,
  LangyMessageProjectionRecord,
  LangyService as LangyServiceContract,
  LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";
import {
  LangyService,
  type LangyConversationCommands,
  type LangyConversationEventsReader,
  type LangyConversationRuntime,
  type LangyRelayCompositionOptions,
} from "../services/langy.service";
import {
  LangyFeedbackPromptPolicy,
  type LangyFeedbackPromptRedis,
} from "../ports/langy-feedback-prompt.port";
import { LangyConversationService } from "../services/langy-conversation.service";
import { LangyMessageService } from "../services/langy-message.service";
import { LangyFinalPartsService } from "../services/langy-final-parts.service";
import { PrismaLangyConversationRepository } from "../repositories/prisma/prisma.langy-conversation.repository";
import { PrismaLangyMessageRepository } from "../repositories/prisma/prisma.langy-message.repository";
import { PrismaLangyCredentialRepository } from "../repositories/prisma/prisma.langy-credential.repository";
import { PrismaLangyTurnAdmissionRepository } from "../repositories/prisma/prisma.langy-turn-admission.repository";
import type { LangyDatabase } from "../repositories/prisma/langy-database.port";
import { PrismaLangyConversationProjectionRepository } from "../repositories/prisma/prisma.langy-conversation-projection.repository";
import { PrismaLangyConversationTurnProjectionRepository } from "../repositories/prisma/prisma.langy-conversation-turn-projection.repository";
import { PrismaLangyMessageProjectionRepository } from "../repositories/prisma/prisma.langy-message-projection.repository";
import { LangyCredentialService } from "../services/langy-credential.service";
import type {
  LangyCredentialErrorReporter,
  LangyCredentialRuntimeService,
  LangyGithubService,
  LangySessionKeyMintingService,
  LangyVirtualKeyService,
} from "../services/langy-credential.service";
import {
  LangySessionKeyService,
  type LangySessionKeyMetricsPort,
} from "../services/langy-session-key.service";
import { PrismaLangySessionKeyRepository } from "../repositories/prisma/prisma.langy-session-key.repository";
import {
  LangyTurnService,
  type LangyTurnTechnicalPorts,
} from "../services/langy-turn.service";

export abstract class LangyTrustedMessagePort {
  abstract getRecordsByConversation(input: {
    conversationId: string;
    projectId: string;
  }): Promise<
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
export class LangyEventingPorts {
  constructor(
    readonly langyConversationState: StateProjectionStore<LangyConversationStateData>,
    readonly langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>,
    readonly langyMessageStorage: AppendStore<LangyMessageProjectionRecord>,
    readonly langyTurnAdmission: LangyTurnAdmissionCapability,
    readonly trustedMessages: LangyTrustedMessagePort,
  ) {}
}

export type LangyServiceCompositionOptions = {
  turns: LangyTurnTechnicalPorts;
  credentials: LangyCredentialComposition;
  commands: LangyConversationCommands;
  events?: LangyConversationEventsReader | null;
  runtime?: LangyConversationRuntime;
  relay?: LangyRelayCompositionOptions;
  feedbackPromptRedis?: LangyFeedbackPromptRedis | null;
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
  private readonly eventingCapabilities: LangyEventingPorts;
  private service: LangyServiceContract | null = null;
  private sessionKeys: LangySessionKeyService | null = null;

  private constructor(private readonly options: PostgresLangyAdapterOptions) {
    this.repositories = {
      conversations: PrismaLangyConversationRepository.create(options.database),
      messages: PrismaLangyMessageRepository.create(options.database),
      credentials: PrismaLangyCredentialRepository.create(options.database),
      admission: PrismaLangyTurnAdmissionRepository.create(options.database),
      conversationState: PrismaLangyConversationProjectionRepository.create(
        options.database,
      ),
      conversationTurnState: PrismaLangyConversationTurnProjectionRepository.create(
        options.database,
      ),
      messageStorage: PrismaLangyMessageProjectionRepository.create(options.database),
      sessionKeys: PrismaLangySessionKeyRepository.create(options.database),
    };
    this.eventingCapabilities = new LangyEventingPorts(
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
  eventing(): LangyEventingPorts {
    return this.eventingCapabilities;
  }

  createSessionKeys(input: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
    metrics: LangySessionKeyMetricsPort;
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
  build(options: LangyServiceCompositionOptions): LangyServiceContract {
    if (this.service) return this.service;

    const conversations = LangyConversationService.create(
      options.commands,
      this.repositories.conversations,
      this.repositories.messages,
      options.events,
      LangyFinalPartsService.create(),
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
    this.service = LangyService.createComposed(
      conversations,
      turns,
      messages,
      credentials,
      LangyFeedbackPromptPolicy.create({
        redis: options.feedbackPromptRedis ?? null,
      }),
      options.relay,
    );
    return this.service;
  }
}
