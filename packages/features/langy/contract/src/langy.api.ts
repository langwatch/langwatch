import { featureApi } from "@langwatch/runtime-composition/contract";
import type {
  LangyConversationDetail,
  LangyConversationEventPage,
  LangyConversationListCursor,
  LangyConversationListPage,
  LangyMessageRow,
  LangyStartConversationTurnInput,
  LangyTurnResultInput,
} from "./langy.service.ts";
import type { LangyCredentialSession, LangyEgressAllowlist, LangyStopTurnInput } from "./langy.ts";
import type { LangyLocalRecord } from "./event-sourcing/folds/turn-fold.ts";
import type { LangyRelayConnection } from "./langy.service.ts";

/** The portable, callable Langy capability shared by process transports. */
export interface LangyApi {
  stopTurn(input: LangyStopTurnInput & { userId: string }): Promise<void>;
  tryGetEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null>;
  trySetEgressAllowlist(input: {
    projectId: string;
    allowlist: LangyEgressAllowlist;
  }): Promise<LangyEgressAllowlist | null>;
  openRelayConnection(): LangyRelayConnection;
  getPage(input: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationListPage>;
  getEventsAfter(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: { acceptedAt: number; eventId: string };
  }): Promise<LangyConversationEventPage>;
  recordUserMessage(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: import("./json.ts").LangyMessagePart[];
    title?: string | null;
    role?: import("./json.ts").LangyMessageRole;
    messageId?: string;
  }): Promise<{ messageId: string }>;
  getLocalRecord(input: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<LangyLocalRecord>;
  tryFindByIdVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail | null>;
  getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail>;
  getAllByConversation(input: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<LangyMessageRow[]>;
  deleteById(input: { id: string; projectId: string; userId: string }): Promise<boolean>;
  updateById(input: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }): Promise<LangyConversationDetail>;
  forkById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ conversation: LangyConversationDetail }>;
  startConversationTurn(input: LangyStartConversationTurnInput): Promise<{
    conversationId: string;
    turnId: string;
  }>;
  warmConversationWorker(input: {
    projectId: string;
    session: LangyCredentialSession;
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }>;
  tryGetModelsAllowedForProject(projectId: string): Promise<string[] | null>;
  revokeWorkerSessionKey(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<"revoked" | "already_revoked" | "not_found" | "refused">;
  shouldAskFeedback(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean>;
  markFeedbackShown(input: { userId: string; conversationId: string }): Promise<void>;
  turnExists(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean>;
  ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void>;
  tryGetRunToken(input: { projectId: string; conversationId: string }): Promise<string | null>;
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
}

export const LangyApi = featureApi<LangyApi>("langy");
