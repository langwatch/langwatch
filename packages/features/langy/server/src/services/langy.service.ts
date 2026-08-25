import {
  LangyConversationNotFoundError,
  LangyService as LangyServiceContract,
  langyConversationInputSchema,
  langyConversationListInputSchema,
  langyCreateConversationInputSchema,
  langyCredentialInputSchema,
  langyEgressAllowlistSchema,
  langyEgressProjectInputSchema,
  langyRelayFrameSchema,
  langyStopTurnInputSchema,
  langyTurnInputSchema,
  type LangyConversation,
  type LangyConversationInput,
  type LangyConversationListInput,
  type LangyConversationPage,
  type LangyCreateConversationInput,
  type LangyCredential,
  type LangyCredentialInput,
  type LangyEgressAllowlist,
  type LangyRelayFrame,
  type LangyStopTurnInput,
  type LangyTurnInput,
  type LangyCredentialSession,
  type LangyConversationDetail as ContractConversationDetail,
  type LangyConversationEventPage,
  type LangyConversationListCursor as ContractConversationListCursor,
  type LangyConversationListPage as ContractConversationListPage,
  type LangyMessageRow as ContractMessageRow,
  type LangyStartConversationTurnInput,
  type LangyTurnResultInput,
  type LangyRelayConnection,
} from "@langwatch/langy-contract";
import {
  ConversationRepository,
  CredentialRepository,
  MessageRepository,
  RelayRepository,
  TurnRepository,
} from "../repositories/langy.repository";
import {
  LangyConversationService,
  ADOPTABLE_CONVERSATION_ID,
  type LangyConversationCommands,
  type LangyConversationEventsReader,
  type LangyConversationRuntime,
  type ConversationDetail,
  type ConversationListItem,
  type ConversationListPage,
} from "./langy-conversation.service";
import {
  LangyMessageService,
  type LangyTrustedMessageReader,
} from "./langy-message.service";
import {
  LangyCredentialService,
  type LangyCredentialServiceOptions,
} from "./langy-credential.service";
import { LangyTurnRelay, type LangyRelayRedis } from "../streaming/langy-turn-relay";
import { LangyFeedbackPromptPolicy } from "../ports/langy-feedback-prompt.port";

export type LangyRelayCompositionOptions = {
  redis: LangyRelayRedis;
  baseHost: string;
  resolveResourceUrl?: (input: {
    projectId: string;
    resourceId: string;
  }) => Promise<string | null>;
  resolveCapabilityProgress?: (name: string) => { headline: string } | null;
  logger?: {
    warn(o: unknown, message: string): void;
    debug?(o: unknown, message: string): void;
  };
};

export type LangyConversationCapability = LangyConversationService;
export type LangyMessageCapability = LangyMessageService;
export type LangyCredentialCapability = LangyCredentialService;
export type {
  LangyConversationCommands,
  LangyConversationEventsReader,
  LangyConversationRuntime,
  LangyTrustedMessageReader,
};
export type { ConversationDetail, ConversationListItem, ConversationListPage };
export { ADOPTABLE_CONVERSATION_ID };

type Repositories = {
  conversations: ConversationRepository;
  turns: TurnRepository;
  messages: MessageRepository;
  credentials: CredentialRepository;
  relay: RelayRepository;
};

type AppCapabilities = {
  conversations: {
    getPage(input: {
      projectId: string;
      userId: string;
      limit: number;
      cursor?: ContractConversationListCursor;
      query?: string;
    }): Promise<ContractConversationListPage>;
    getEventsAfter(input: {
      projectId: string;
      conversationId: string;
      userId: string;
      after: { acceptedAt: number; eventId: string };
    }): Promise<LangyConversationEventPage>;
    tryFindByIdVisible(input: {
      id: string;
      projectId: string;
      userId: string;
    }): Promise<ContractConversationDetail | null>;
    getById(input: {
      id: string;
      projectId: string;
      userId: string;
    }): Promise<ContractConversationDetail>;
    deleteById(input: {
      id: string;
      projectId: string;
      userId: string;
    }): Promise<boolean>;
    updateById(input: {
      id: string;
      projectId: string;
      userId: string;
      title?: string | null;
      isShared?: boolean;
    }): Promise<ContractConversationDetail>;
    forkById(input: {
      id: string;
      projectId: string;
      userId: string;
    }): Promise<{ conversation: ContractConversationDetail }>;
    turnExists(input: {
      projectId: string;
      conversationId: string;
      turnId: string;
    }): Promise<boolean>;
    ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void>;
    tryGetRunToken(input: {
      projectId: string;
      conversationId: string;
    }): Promise<string | null>;
    recordToolCallStarted(input: {
      projectId: string;
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName: string;
      command?: string;
      input?: unknown;
    }): Promise<void>;
    recordToolCallCompleted(input: {
      projectId: string;
      conversationId: string;
      turnId: string;
      toolCallId: string;
      toolName: string;
      isError?: boolean;
      command?: string;
      input?: unknown;
      durationMs?: number;
      errorText?: string;
    }): Promise<void>;
    recordTurnHandoff(input: {
      projectId: string;
      conversationId: string;
      turnId: string;
      token: string;
    }): Promise<void>;
    recordPlanUpdated(input: {
      projectId: string;
      conversationId: string;
      turnId: string;
      items: Array<{ content: string; status: string }>;
    }): Promise<void>;
  };
  messages: {
    getAllByConversation(input: {
      conversationId: string;
      projectId: string;
      userId: string;
    }): Promise<ContractMessageRow[]>;
  };
  turns: {
    startConversationTurn(input: LangyStartConversationTurnInput): Promise<{
      conversationId: string;
      turnId: string;
    }>;
    stopTurn(input: {
      projectId: string;
      conversationId: string;
      turnId: string;
      userId: string;
    }): Promise<void>;
    warmConversationWorker(input: {
      projectId: string;
      session: LangyCredentialSession;
      requestedConversationId: string | null;
      modelOverride?: string;
    }): Promise<{ conversationId: string | null; warmed: boolean }>;
  };
  credentials: {
    tryGetModelsAllowedForProject(projectId: string): Promise<string[] | null>;
  };
};

export type LangyLegacyCapabilities = {
  conversations: object;
  turns: object;
  messages: object;
  credentials: object;
};

type SelectedCapabilities<C> = C extends LangyLegacyCapabilities ? C : never;

export class LangyService<Capabilities = never> extends LangyServiceContract {
  declare readonly conversations: SelectedCapabilities<Capabilities>["conversations"];
  declare readonly turns: SelectedCapabilities<Capabilities>["turns"];
  declare readonly messages: SelectedCapabilities<Capabilities>["messages"];
  declare readonly credentials: SelectedCapabilities<Capabilities>["credentials"];

  private constructor(
    private readonly repositories: Repositories | null,
    private readonly feedbackPrompt: LangyFeedbackPromptPolicy,
    capabilities?: Capabilities,
    private readonly relayOptions: LangyRelayCompositionOptions | null = null,
  ) {
    super();
    if (capabilities !== undefined) {
      Object.assign(this, capabilities);
    }
  }

  static create(
    options: Repositories,
    feedbackPrompt: LangyFeedbackPromptPolicy,
  ): LangyService {
    return new LangyService(options, feedbackPrompt);
  }

  static compose<Capabilities extends LangyLegacyCapabilities>(
    capabilities: Capabilities,
    feedbackPrompt: LangyFeedbackPromptPolicy,
    relayOptions?: LangyRelayCompositionOptions,
  ): LangyService<Capabilities> {
    return new LangyService<Capabilities>(
      null,
      feedbackPrompt,
      capabilities,
      relayOptions ?? null,
    );
  }

  openRelayConnection(): LangyRelayConnection {
    if (!this.relayOptions) {
      throw new Error("Langy relay is not configured");
    }
    return LangyTurnRelay.create({
      conversations: this,
      redis: this.relayOptions.redis,
      baseHost: this.relayOptions.baseHost,
      ...(this.relayOptions.resolveResourceUrl
        ? {
            resolveResourceUrl: this.relayOptions.resolveResourceUrl,
          }
        : {}),
      ...(this.relayOptions.resolveCapabilityProgress
        ? { resolveCapabilityProgress: this.relayOptions.resolveCapabilityProgress }
        : {}),
      ...(this.relayOptions.logger ? { logger: this.relayOptions.logger } : {}),
    });
  }

  /** Composition-only factories keep concrete capability classes private. */
  static createConversationCapability(
    ...args: Parameters<typeof LangyConversationService.create>
  ): LangyConversationCapability {
    return LangyConversationService.create(...args);
  }

  static createMessageCapability(
    ...args: Parameters<typeof LangyMessageService.create>
  ): LangyMessageCapability {
    return LangyMessageService.create(...args);
  }

  static createCredentialCapability(
    options: LangyCredentialServiceOptions,
  ): LangyCredentialCapability {
    return LangyCredentialService.create(options);
  }

  static extractTextFromParts(parts: unknown): string {
    return LangyMessageService.extractTextFromParts(parts);
  }

  static createTrustedMessageReader(
    ...args: Parameters<typeof LangyMessageService.createTrustedMessageReader>
  ): LangyTrustedMessageReader {
    return LangyMessageService.createTrustedMessageReader(...args);
  }

  private get persistence(): Repositories {
    if (this.repositories === null) {
      throw new Error("Langy persistence is not configured");
    }
    return this.repositories;
  }

  listConversations(input: LangyConversationListInput): Promise<LangyConversationPage> {
    return this.persistence.conversations.list(
      langyConversationListInputSchema.parse(input),
    );
  }

  async getConversation(input: LangyConversationInput): Promise<LangyConversation> {
    const parsed = langyConversationInputSchema.parse(input);
    const result = await this.persistence.conversations.tryGet(parsed);
    if (!result) {
      throw new LangyConversationNotFoundError(parsed.conversationId);
    }
    return result;
  }

  createConversation(input: LangyCreateConversationInput): Promise<LangyConversation> {
    return this.persistence.conversations.create(
      langyCreateConversationInputSchema.parse(input),
    );
  }

  async archiveConversation(input: LangyConversationInput): Promise<void> {
    const parsed = langyConversationInputSchema.parse(input);
    await this.getConversation(parsed);
    await this.persistence.conversations.archive(parsed);
  }

  startTurn(
    input: LangyTurnInput,
  ): Promise<{ conversation: LangyConversation; turnId: string }> {
    return this.startTurnForConversation(langyTurnInputSchema.parse(input));
  }

  async stopTurn(input: LangyStopTurnInput & { userId?: string }): Promise<void> {
    if (input.userId !== undefined) {
      await this.appCapabilities().turns.stopTurn(
        input as {
          projectId: string;
          conversationId: string;
          turnId: string;
          userId: string;
        },
      );
      return;
    }
    const parsed = langyStopTurnInputSchema.parse(input);
    await this.getConversation(parsed);
    await this.persistence.turns.stop(parsed);
  }

  async listMessages(input: LangyConversationInput): Promise<readonly unknown[]> {
    const parsed = langyConversationInputSchema.parse(input);
    await this.getConversation(parsed);
    return this.persistence.messages.list(parsed);
  }

  resolveCredential(input: LangyCredentialInput): Promise<LangyCredential> {
    return this.persistence.credentials.resolve(langyCredentialInputSchema.parse(input));
  }

  tryGetEgressAllowlist(input: {
    projectId: string;
  }): Promise<LangyEgressAllowlist | null> {
    const projectId = langyEgressProjectInputSchema.parse(input).projectId;
    return this.persistence.credentials.tryGetEgressAllowlist(projectId);
  }

  trySetEgressAllowlist(input: {
    projectId: string;
    allowlist: LangyEgressAllowlist;
  }): Promise<LangyEgressAllowlist | null> {
    const projectId = langyEgressProjectInputSchema.parse(input).projectId;
    const allowlist = langyEgressAllowlistSchema.parse(input.allowlist);
    return this.persistence.credentials.trySetEgressAllowlist(
      projectId,
      allowlist.length > 0 ? allowlist : null,
    );
  }

  relay(frame: LangyRelayFrame): Promise<void> {
    return this.persistence.relay.publish(langyRelayFrameSchema.parse(frame));
  }

  private appCapabilities(): AppCapabilities {
    return this as unknown as AppCapabilities;
  }

  getPage(
    input: Parameters<AppCapabilities["conversations"]["getPage"]>[0],
  ): Promise<ContractConversationListPage> {
    return this.appCapabilities().conversations.getPage(input);
  }

  getEventsAfter(
    input: Parameters<AppCapabilities["conversations"]["getEventsAfter"]>[0],
  ): Promise<LangyConversationEventPage> {
    return this.appCapabilities().conversations.getEventsAfter(input);
  }

  tryFindByIdVisible(
    input: Parameters<AppCapabilities["conversations"]["tryFindByIdVisible"]>[0],
  ): Promise<ContractConversationDetail | null> {
    return this.appCapabilities().conversations.tryFindByIdVisible(input);
  }

  getById(
    input: Parameters<AppCapabilities["conversations"]["getById"]>[0],
  ): Promise<ContractConversationDetail> {
    return this.appCapabilities().conversations.getById(input);
  }

  getAllByConversation(
    input: Parameters<AppCapabilities["messages"]["getAllByConversation"]>[0],
  ): Promise<ContractMessageRow[]> {
    return this.appCapabilities().messages.getAllByConversation(input);
  }

  deleteById(
    input: Parameters<AppCapabilities["conversations"]["deleteById"]>[0],
  ): Promise<boolean> {
    return this.appCapabilities().conversations.deleteById(input);
  }

  updateById(
    input: Parameters<AppCapabilities["conversations"]["updateById"]>[0],
  ): Promise<ContractConversationDetail> {
    return this.appCapabilities().conversations.updateById(input);
  }

  forkById(
    input: Parameters<AppCapabilities["conversations"]["forkById"]>[0],
  ): Promise<{ conversation: ContractConversationDetail }> {
    return this.appCapabilities().conversations.forkById(input);
  }

  startConversationTurn(
    input: LangyStartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.appCapabilities().turns.startConversationTurn(input);
  }

  warmConversationWorker(
    input: Parameters<AppCapabilities["turns"]["warmConversationWorker"]>[0],
  ): Promise<{ conversationId: string | null; warmed: boolean }> {
    return this.appCapabilities().turns.warmConversationWorker(input);
  }

  tryGetModelsAllowedForProject(projectId: string): Promise<string[] | null> {
    return this.appCapabilities().credentials.tryGetModelsAllowedForProject(projectId);
  }

  shouldAskFeedback(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean> {
    return this.feedbackPrompt.shouldAsk(input);
  }

  markFeedbackShown(input: { userId: string; conversationId: string }): Promise<void> {
    return this.feedbackPrompt.markShown(input);
  }

  turnExists(
    input: Parameters<AppCapabilities["conversations"]["turnExists"]>[0],
  ): Promise<boolean> {
    return this.appCapabilities().conversations.turnExists(input);
  }

  ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void> {
    return this.appCapabilities().conversations.ingestAgentTurnResult(input);
  }

  tryGetRunToken(
    input: Parameters<AppCapabilities["conversations"]["tryGetRunToken"]>[0],
  ): Promise<string | null> {
    return this.appCapabilities().conversations.tryGetRunToken(input);
  }

  recordToolCallStarted(
    input: Parameters<AppCapabilities["conversations"]["recordToolCallStarted"]>[0],
  ): Promise<void> {
    return this.appCapabilities().conversations.recordToolCallStarted(input);
  }

  recordToolCallCompleted(
    input: Parameters<AppCapabilities["conversations"]["recordToolCallCompleted"]>[0],
  ): Promise<void> {
    return this.appCapabilities().conversations.recordToolCallCompleted(input);
  }

  recordTurnHandoff(
    input: Parameters<AppCapabilities["conversations"]["recordTurnHandoff"]>[0],
  ): Promise<void> {
    return this.appCapabilities().conversations.recordTurnHandoff(input);
  }

  recordPlanUpdated(
    input: Parameters<AppCapabilities["conversations"]["recordPlanUpdated"]>[0],
  ): Promise<void> {
    return this.appCapabilities().conversations.recordPlanUpdated(input);
  }

  private async startTurnForConversation(
    input: LangyTurnInput,
  ): Promise<{ conversation: LangyConversation; turnId: string }> {
    await this.getConversation(input);
    return this.persistence.turns.start(input);
  }
}
