import type {
  AppendStore,
  StateProjectionStore,
} from "@langwatch/eventing";
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
} from "../services/langy.service";
import { LangyConversationService } from "../services/langy-conversation.service";
import { LangyMessageService } from "../services/langy-message.service";
import { LangyFinalPartsService } from "../services/langy-final-parts.service";
import { PrismaLangyConversationRepository } from "../repositories/prisma/prisma.langy-conversation.repository";
import { PrismaLangyMessageRepository } from "../repositories/prisma/prisma.langy-message.repository";
import { PrismaLangyCredentialRepository } from "../repositories/prisma/prisma.langy-credential.repository";
import { PrismaLangyTurnAdmissionRepository } from "../repositories/prisma/prisma.langy-turn-admission.repository";
import { PrismaLangyConversationProjectionRepository } from "../repositories/prisma/prisma.langy-conversation-projection.repository";
import { PrismaLangyConversationTurnProjectionRepository } from "../repositories/prisma/prisma.langy-conversation-turn-projection.repository";
import { PrismaLangyMessageProjectionRepository } from "../repositories/prisma/prisma.langy-message-projection.repository";
import { LangyCredentialService } from "../services/langy-credential.service";
import type { LangyCredentialServiceOptions } from "../services/langy-credential.service";

/**
 * A message row that is safe to pass across the application composition
 * boundary. The Prisma row and repository stay private to this package.
 */
export interface LangyMessageTurnCompositionCapability {
  findAllByConversation(input: {
    conversationId: string;
    projectId: string;
  }): Promise<
    Array<{
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      parts: LangyMessagePart[];
      createdAt: Date;
    }>
  >;
}

export interface LangyTrustedMessageCompositionCapability {
  getRecordsByConversation(input: {
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

/**
 * The only persistence capabilities exposed to the application composer.
 * Their concrete implementations, including Prisma, remain inside this
 * package. Application code supplies the turn orchestration around these
 * opaque ports.
 */
export interface LangyTurnCompositionPorts {
  conversations: LangyConversationTurnCapability;
  credentials: LangyCredentialTurnCapability;
  messages: LangyMessageTurnCompositionCapability;
  admission: LangyTurnAdmissionCapability;
  trustedMessages: LangyTrustedMessageCompositionCapability;
}

/** Application-owned optional capabilities; the credential repository remains private. */
export type LangyCredentialComposition = () => Omit<
  LangyCredentialServiceOptions,
  "repository"
>;

export type LangyTurnComposition = (
  ports: LangyTurnCompositionPorts,
) => object;

export interface LangyCompositionCapabilities {
  turns: LangyTurnComposition;
  credentials: LangyCredentialComposition;
  feedbackPrompt: object;
}

/** Generic capabilities needed before the Langy command pipeline is bound. */
export interface LangyEventingCapabilities {
  langyConversationState: StateProjectionStore<LangyConversationStateData>;
  langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>;
  langyMessageStorage: AppendStore<LangyMessageProjectionRecord>;
  langyTurnAdmission: LangyTurnAdmissionCapability;
  trustedMessages: LangyTrustedMessageCompositionCapability;
}

export interface LangyServiceCompositionOptions
  extends LangyCompositionCapabilities {
  commands: LangyConversationCommands;
  events?: LangyConversationEventsReader | null;
  runtime?: LangyConversationRuntime;
}

export interface PostgresLangyAdapterOptions {
  database: object;
}

interface LangyRepositories {
  conversations: PrismaLangyConversationRepository;
  messages: PrismaLangyMessageRepository;
  credentials: PrismaLangyCredentialRepository;
  admission: PrismaLangyTurnAdmissionRepository;
  conversationState: PrismaLangyConversationProjectionRepository;
  conversationTurnState: PrismaLangyConversationTurnProjectionRepository;
  messageStorage: PrismaLangyMessageProjectionRepository;
}

/** Composes the Langy capability graph while keeping persistence private. */
export class PostgresLangyAdapter {
  private readonly repositories: LangyRepositories;
  private readonly eventingCapabilities: LangyEventingCapabilities;
  private service: LangyServiceContract | null = null;

  private constructor(private readonly options: PostgresLangyAdapterOptions) {
    this.repositories = {
      conversations: PrismaLangyConversationRepository.create(options.database),
      messages: PrismaLangyMessageRepository.create(options.database),
      credentials: PrismaLangyCredentialRepository.create(options.database),
      admission: PrismaLangyTurnAdmissionRepository.create(options.database),
      conversationState:
        PrismaLangyConversationProjectionRepository.create(options.database),
      conversationTurnState:
        PrismaLangyConversationTurnProjectionRepository.create(options.database),
      messageStorage: PrismaLangyMessageProjectionRepository.create(
        options.database,
      ),
    };
    this.eventingCapabilities = {
      langyConversationState: this.repositories.conversationState,
      langyConversationTurnState: this.repositories.conversationTurnState,
      langyMessageStorage: this.repositories.messageStorage,
      langyTurnAdmission: this.repositories.admission,
      trustedMessages: LangyMessageService.createTrustedMessageReader(
        this.repositories.messages,
      ),
    };
  }

  static create(options: PostgresLangyAdapterOptions): PostgresLangyAdapter {
    return new PostgresLangyAdapter(options);
  }

  /**
   * Returns stable generic stores for PipelineRegistry. No concrete Prisma
   * repository appears in this return type or crosses the feature boundary.
   */
  eventing(): LangyEventingCapabilities {
    return this.eventingCapabilities;
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
      ...options.credentials(),
    });

    const capabilities = {
      conversations,
      turns: options.turns({
        conversations,
        credentials,
        messages: this.repositories.messages,
        admission: this.repositories.admission,
        trustedMessages: this.eventingCapabilities.trustedMessages,
      }),
      messages,
      credentials,
      feedbackPrompt: options.feedbackPrompt,
    };
    this.service = LangyService.compose(capabilities);
    return this.service;
  }
}
