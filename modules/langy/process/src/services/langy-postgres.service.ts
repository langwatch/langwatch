import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AppendStore, StateProjectionStore } from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
  LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";

import type { LangyConversationCommands } from "../eventing/langy-conversation.commands.ts";
import type { LangyFeedbackPromptRepository } from "../repositories/langy-feedback-prompt.repository.ts";
import type { LangyDatabaseRepositories } from "../repositories/langy-repositories.registry.ts";
import type { LangyBlockMetrics } from "./langy-block-metrics-otel.service.ts";
import { LangyConversationService } from "./langy-conversation.service.ts";
import {
  LangyCredentialService,
  type LangyCredentialErrorReporter,
  type LangyCredentialRuntimeService,
  type LangyGithubService,
  type LangySessionKeyMintingService,
  type LangyVirtualKeyService,
} from "./langy-credential.service.ts";
import { LangyFeedbackPromptService } from "./langy-feedback-prompt.service.ts";
import { LangyFinalPartsService } from "./langy-final-parts.service.ts";
import { LangyMessageService } from "./langy-message.service.ts";
import type { LangySessionKeyMetrics } from "./langy-session-key.service.ts";
import { LangySessionKeyService } from "./langy-session-key.service.ts";
import { LangyTurnService, type LangyTurnTechnicalMembers } from "./langy-turn.service.ts";
import {
  LangyService,
  type OpenLangyRelay,
  type LangyConversationEventsReader,
  type LangyConversationRuntime,
} from "./langy.service.ts";

export abstract class LangyTrustedMessage {
  abstract getRecordsByConversation(input: { conversationId: string; projectId: string }): Promise<
    {
      id: string;
      role: "user" | "assistant" | "tool" | "system";
      content: string;
    }[]
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
  readonly langyConversationState: StateProjectionStore<LangyConversationStateData>;
  readonly langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>;
  readonly langyMessageStorage: AppendStore<LangyMessageProjectionRecord>;
  readonly langyTurnAdmission: LangyTurnAdmissionCapability;
  readonly trustedMessages: LangyTrustedMessage;

  constructor(input: {
    langyConversationState: StateProjectionStore<LangyConversationStateData>;
    langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>;
    langyMessageStorage: AppendStore<LangyMessageProjectionRecord>;
    langyTurnAdmission: LangyTurnAdmissionCapability;
    trustedMessages: LangyTrustedMessage;
  }) {
    this.langyConversationState = input.langyConversationState;
    this.langyConversationTurnState = input.langyConversationTurnState;
    this.langyMessageStorage = input.langyMessageStorage;
    this.langyTurnAdmission = input.langyTurnAdmission;
    this.trustedMessages = input.trustedMessages;
  }
}

/** How this process's Langy relay reaches Redis, and what it resolves for the agent. */
export type LangyServiceCompositionOptions = {
  turns: LangyTurnTechnicalMembers;
  credentials: LangyCredentialComposition;
  commands: LangyConversationCommands;
  events?: LangyConversationEventsReader | null;
  runtime?: LangyConversationRuntime;
  openRelay: OpenLangyRelay;
  feedbackPrompts: LangyFeedbackPromptRepository;
  blockMetrics: LangyBlockMetrics;
};

export interface LangyPostgresServiceOptions {
  repositories: LangyDatabaseRepositories;
}

/** Composes the Langy capability graph while keeping persistence private. */
export class LangyPostgresService {
  private readonly repositories: LangyDatabaseRepositories;
  private readonly eventingCapabilities: LangyEventingMembers;
  private service: LangyService | null = null;
  private sessionKeys: LangySessionKeyService | null = null;

  private constructor(options: LangyPostgresServiceOptions) {
    this.repositories = options.repositories;
    this.eventingCapabilities = new LangyEventingMembers({
      langyConversationState: this.repositories.conversationState,
      langyConversationTurnState: this.repositories.conversationTurnState,
      langyMessageStorage: this.repositories.messageStorage,
      langyTurnAdmission: this.repositories.admission,
      trustedMessages: LangyMessageService.createTrustedMessageReader(this.repositories.messages),
    });
  }

  static create(options: LangyPostgresServiceOptions): LangyPostgresService {
    return new LangyPostgresService(options);
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
    authz: Pick<AuthzApi, "effectivePermissions">;
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

    const conversations = LangyConversationService.create({
      commands: options.commands,
      repository: this.repositories.conversations,
      messages: this.repositories.messages,
      events: options.events,
      finalParts: LangyFinalPartsService.create(options.blockMetrics.blockCounter()),
      runtime: options.runtime,
    });
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
    this.service = LangyService.create({
      conversations,
      turns,
      messages,
      credentials,
      feedbackPrompt: LangyFeedbackPromptService.create({
        prompts: options.feedbackPrompts,
      }),
      openRelay: options.openRelay,
    });
    return this.service;
  }
}
