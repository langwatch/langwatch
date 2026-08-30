import {
  type LangyConversation,
  type LangyConversationDetail as ContractConversationDetail,
  type LangyConversationEventPage,
  type LangyConversationInput,
  langyConversationInputSchema,
  type LangyConversationListCursor as ContractConversationListCursor,
  type LangyConversationListInput,
  langyConversationListInputSchema,
  type LangyConversationListPage as ContractConversationListPage,
  LangyConversationNotFoundError,
  type LangyConversationPage,
  type LangyCreateConversationInput,
  langyCreateConversationInputSchema,
  type LangyCredential,
  type LangyCredentialInput,
  langyCredentialInputSchema,
  type LangyCredentialSession,
  type LangyEgressAllowlist,
  langyEgressProjectInputSchema,
  type LangyMessageRow as ContractMessageRow,
  type LangyRelayConnection,
  type LangyRelayFrame,
  langyRelayFrameSchema,
  LangyService as LangyServiceContract,
  langySetEgressInputSchema,
  type LangyStartConversationTurnInput,
  type LangyStopTurnInput,
  type LangyTurnInput,
  langyTurnInputSchema,
  type LangyTurnResultInput,
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
import { LangyMessageService, type LangyTrustedMessageReader } from "./langy-message.service";
import { LangyTurnService } from "./langy-turn.service";
import { LangyCredentialService } from "./langy-credential.service";
import { LangyTurnRelay, type LangyRelayRedis } from "../streaming/langy-turn-relay";
import { LangyFeedbackPromptPolicy } from "../ports/langy-feedback-prompt.port";

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

export class LangyService extends LangyServiceContract {
  private constructor(
    private readonly repositories: Repositories | null,
    private readonly feedbackPrompt: LangyFeedbackPromptPolicy,
    private readonly conversations: LangyConversationService | null = null,
    private readonly turns: LangyTurnService | null = null,
    private readonly messages: LangyMessageService | null = null,
    private readonly credentials: LangyCredentialService | null = null,
    private readonly relayOptions: LangyRelayCompositionOptions | null = null,
  ) {
    super();
  }

  static create(options: Repositories, feedbackPrompt: LangyFeedbackPromptPolicy): LangyService {
    return new LangyService(options, feedbackPrompt);
  }

  /** Builds the process-owned capability from the complete Langy services. */
  static createComposed(
    conversations: LangyConversationService,
    turns: LangyTurnService,
    messages: LangyMessageService,
    credentials: LangyCredentialService,
    feedbackPrompt: LangyFeedbackPromptPolicy,
    relayOptions?: LangyRelayCompositionOptions,
  ): LangyService {
    return new LangyService(
      null,
      feedbackPrompt,
      conversations,
      turns,
      messages,
      credentials,
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

  private get persistence(): Repositories {
    if (this.repositories === null) {
      throw new Error("Langy persistence is not configured");
    }
    return this.repositories;
  }

  listConversations(input: LangyConversationListInput): Promise<LangyConversationPage> {
    return this.persistence.conversations.list(langyConversationListInputSchema.parse(input));
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
    return this.persistence.conversations.create(langyCreateConversationInputSchema.parse(input));
  }

  async archiveConversation(input: LangyConversationInput): Promise<void> {
    const parsed = langyConversationInputSchema.parse(input);
    await this.getConversation(parsed);
    await this.persistence.conversations.archive(parsed);
  }

  startTurn(input: LangyTurnInput): Promise<{ conversation: LangyConversation; turnId: string }> {
    return this.startTurnForConversation(langyTurnInputSchema.parse(input));
  }

  /**
   * The contract declares `userId` as required, and `LangyApp.stopTurn` — the
   * only door — types it that way too. This widened it to `userId?` and carried
   * a second branch for the absent case, which read `this.persistence` and so
   * could only ever have thrown. Nothing could reach it.
   */
  async stopTurn(input: LangyStopTurnInput & { userId: string }): Promise<void> {
    await this.turnService.stopTurn(input);
  }

  async listMessages(input: LangyConversationInput): Promise<readonly unknown[]> {
    const parsed = langyConversationInputSchema.parse(input);
    await this.getConversation(parsed);
    return this.persistence.messages.list(parsed);
  }

  resolveCredential(input: LangyCredentialInput): Promise<LangyCredential> {
    return this.persistence.credentials.resolve(langyCredentialInputSchema.parse(input));
  }

  /**
   * Reached from `LangyApp.egressAllowlist`, and so from the `langyEgress` tRPC
   * door. It used to read `this.persistence`, which `createComposed` sets to
   * null — every composed process would have answered the first caller with
   * "Langy persistence is not configured", degraded to a generic unknown error.
   * `LangyCredentialService` was already being passed in and never read.
   */
  tryGetEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null> {
    const projectId = langyEgressProjectInputSchema.parse(input).projectId;
    return this.credentialService.tryGetEgressAllowlist({ projectId });
  }

  /**
   * The write half of the same door. It had a second fault of its own: it
   * validated the WHOLE input against `langyEgressProjectInputSchema`, which is
   * `.strict()` and knows only `projectId`, so every call was rejected with
   * "Unrecognized key: allowlist" before it could reach anything. The contract
   * publishes `langySetEgressInputSchema` for exactly this shape.
   */
  trySetEgressAllowlist(input: {
    projectId: string;
    allowlist: LangyEgressAllowlist;
  }): Promise<LangyEgressAllowlist | null> {
    const { projectId, allowlist } = langySetEgressInputSchema.parse(input);
    return this.credentialService.trySetEgressAllowlist({ projectId, allowlist });
  }

  relay(frame: LangyRelayFrame): Promise<void> {
    return this.persistence.relay.publish(langyRelayFrameSchema.parse(frame));
  }

  private get conversationService(): LangyConversationService {
    if (this.conversations === null) {
      throw new Error("Langy runtime is not configured");
    }
    return this.conversations;
  }

  private get turnService(): LangyTurnService {
    if (this.turns === null) {
      throw new Error("Langy runtime is not configured");
    }
    return this.turns;
  }

  private get messageService(): LangyMessageService {
    if (this.messages === null) {
      throw new Error("Langy runtime is not configured");
    }
    return this.messages;
  }

  private get credentialService(): LangyCredentialService {
    if (this.credentials === null) {
      throw new Error("Langy runtime is not configured");
    }
    return this.credentials;
  }

  getPage(input: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: ContractConversationListCursor;
    query?: string;
  }): Promise<ContractConversationListPage> {
    return this.conversationService.getPage(input);
  }

  getEventsAfter(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: { acceptedAt: number; eventId: string };
  }): Promise<LangyConversationEventPage> {
    return this.conversationService.getEventsAfter(input);
  }

  tryFindByIdVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ContractConversationDetail | null> {
    return this.conversationService.tryFindByIdVisible(input);
  }

  getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ContractConversationDetail> {
    return this.conversationService.getById(input);
  }

  getAllByConversation(input: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<ContractMessageRow[]> {
    return this.messageService.getAllByConversation(input);
  }

  deleteById(input: { id: string; projectId: string; userId: string }): Promise<boolean> {
    return this.conversationService.deleteById(input);
  }

  updateById(input: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }): Promise<ContractConversationDetail> {
    return this.conversationService.updateById(input);
  }

  forkById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ conversation: ContractConversationDetail }> {
    return this.conversationService.forkById(input);
  }

  startConversationTurn(
    input: LangyStartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.turnService.startConversationTurn(input);
  }

  warmConversationWorker(input: {
    projectId: string;
    session: LangyCredentialSession;
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    return this.turnService.warmConversationWorker(input);
  }

  tryGetModelsAllowedForProject(projectId: string): Promise<string[] | null> {
    return this.credentialService.tryGetModelsAllowedForProject(projectId);
  }

  revokeWorkerSessionKey(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<"revoked" | "already_revoked" | "not_found" | "refused"> {
    return this.credentialService.revokeWorkerSessionKey(input);
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

  turnExists(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    return this.conversationService.turnExists(input);
  }

  ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void> {
    return this.conversationService.ingestAgentTurnResult(input);
  }

  tryGetRunToken(input: { projectId: string; conversationId: string }): Promise<string | null> {
    return this.conversationService.tryGetRunToken(input);
  }

  recordToolCallStarted(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    command?: string;
    input?: unknown;
  }): Promise<void> {
    return this.conversationService.recordToolCallStarted(input);
  }

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
  }): Promise<void> {
    return this.conversationService.recordToolCallCompleted(input);
  }

  recordTurnHandoff(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void> {
    return this.conversationService.recordTurnHandoff(input);
  }

  recordPlanUpdated(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
  }): Promise<void> {
    return this.conversationService.recordPlanUpdated(input);
  }

  private async startTurnForConversation(
    input: LangyTurnInput,
  ): Promise<{ conversation: LangyConversation; turnId: string }> {
    await this.getConversation(input);
    return this.persistence.turns.start(input);
  }
}
