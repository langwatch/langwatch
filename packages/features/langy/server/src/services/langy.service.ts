import {
  type LangyConversationDetail as ContractConversationDetail,
  type LangyConversationEventPage,
  type LangyConversationListCursor as ContractConversationListCursor,
  type LangyConversationListPage as ContractConversationListPage,
  type LangyMessageRow as ContractMessageRow,
  LangyService as LangyServiceContract,
  type LangyCredentialSession,
  type LangyEgressAllowlist,
  langyEgressProjectInputSchema,
  type LangyRelayConnection,
  langySetEgressInputSchema,
  type LangyStartConversationTurnInput,
  type LangyStopTurnInput,
  type LangyTurnResultInput,
} from "@langwatch/langy-contract";
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

export class LangyService extends LangyServiceContract {
  private constructor(
    private readonly feedbackPrompt: LangyFeedbackPromptPolicy,
    private readonly conversations: LangyConversationService,
    private readonly turns: LangyTurnService,
    private readonly messages: LangyMessageService,
    private readonly credentials: LangyCredentialService,
    private readonly relayOptions: LangyRelayCompositionOptions | null = null,
  ) {
    super();
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

  async stopTurn(input: LangyStopTurnInput & { userId: string }): Promise<void> {
    await this.turns.stopTurn(input);
  }

  tryGetEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null> {
    const projectId = langyEgressProjectInputSchema.parse(input).projectId;
    return this.credentials.tryGetEgressAllowlist({ projectId });
  }

  trySetEgressAllowlist(input: {
    projectId: string;
    allowlist: LangyEgressAllowlist;
  }): Promise<LangyEgressAllowlist | null> {
    const { projectId, allowlist } = langySetEgressInputSchema.parse(input);
    return this.credentials.trySetEgressAllowlist({ projectId, allowlist });
  }

  getPage(input: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: ContractConversationListCursor;
    query?: string;
  }): Promise<ContractConversationListPage> {
    return this.conversations.getPage(input);
  }

  getEventsAfter(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: { acceptedAt: number; eventId: string };
  }): Promise<LangyConversationEventPage> {
    return this.conversations.getEventsAfter(input);
  }

  tryFindByIdVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ContractConversationDetail | null> {
    return this.conversations.tryFindByIdVisible(input);
  }

  getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ContractConversationDetail> {
    return this.conversations.getById(input);
  }

  getAllByConversation(input: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<ContractMessageRow[]> {
    return this.messages.getAllByConversation(input);
  }

  deleteById(input: { id: string; projectId: string; userId: string }): Promise<boolean> {
    return this.conversations.deleteById(input);
  }

  updateById(input: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }): Promise<ContractConversationDetail> {
    return this.conversations.updateById(input);
  }

  forkById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ conversation: ContractConversationDetail }> {
    return this.conversations.forkById(input);
  }

  startConversationTurn(
    input: LangyStartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    return this.turns.startConversationTurn(input);
  }

  warmConversationWorker(input: {
    projectId: string;
    session: LangyCredentialSession;
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }> {
    return this.turns.warmConversationWorker(input);
  }

  tryGetModelsAllowedForProject(projectId: string): Promise<string[] | null> {
    return this.credentials.tryGetModelsAllowedForProject(projectId);
  }

  revokeWorkerSessionKey(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<"revoked" | "already_revoked" | "not_found" | "refused"> {
    return this.credentials.revokeWorkerSessionKey(input);
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
    return this.conversations.turnExists(input);
  }

  ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void> {
    return this.conversations.ingestAgentTurnResult(input);
  }

  tryGetRunToken(input: { projectId: string; conversationId: string }): Promise<string | null> {
    return this.conversations.tryGetRunToken(input);
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
    return this.conversations.recordToolCallStarted(input);
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
    return this.conversations.recordToolCallCompleted(input);
  }

  recordTurnHandoff(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void> {
    return this.conversations.recordTurnHandoff(input);
  }

  recordPlanUpdated(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
  }): Promise<void> {
    return this.conversations.recordPlanUpdated(input);
  }
}
