import { moduleApi } from "@langwatch/kernel/module-api";

import type { LangyLocalRecord } from "./event-sourcing/folds/turn-fold.ts";
import type * as jsonModule from "./json.ts";
import type {
  LangyConversationDetail,
  LangyConversationEventPage,
  LangyConversationListCursor,
  LangyConversationListPage,
  LangyMessageRow,
  LangyRelayConnection,
  LangyStartConversationTurnInput,
  LangyTurnResultInput,
} from "./langy-conversation.ts";
import type { RelayTally } from "./langy-rest.schemas.ts";
import type { LangyCredentialSession, LangyEgressAllowlist, LangyStopTurnInput } from "./langy.ts";

/**
 * What the install-wide usage report counts here (ADR-156, section 10): turns
 * taken and people active (by last activity), since `since` where one is
 * given, and when the first turn was. Times are epoch milliseconds.
 */
export interface LangyUsageCount {
  readonly turns: number;
  readonly activeUsers: number;
  readonly firstTurnAt?: number;
}

/** The portable, callable Langy capability shared by process transports. */
export interface LangyApi {
  ingestInternalTurnResult(input: LangyTurnResultInput): Promise<{ status: "accepted" }>;
  revokeInternalCredentials(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<{ outcome: "revoked" | "already_revoked" }>;
  receiveInternalFrames(body: ReadableStream<Uint8Array> | null): Promise<RelayTally>;
  stopTurn(input: LangyStopTurnInput & { userId: string }): Promise<void>;
  findEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null>;
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
    parts: jsonModule.LangyMessagePart[];
    title?: string | null;
    role?: jsonModule.LangyMessageRole;
    messageId?: string;
  }): Promise<{ messageId: string }>;
  getLocalRecord(input: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<LangyLocalRecord>;
  findByIdVisible(input: {
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
  findModelsAllowedForProject(projectId: string): Promise<string[] | null>;
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
  findRunToken(input: { projectId: string; conversationId: string }): Promise<string | null>;
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
    items: { content: string; status: string }[];
  }): Promise<void>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<LangyUsageCount>;
  /** Mints a new project's gateway key so it is listed from day one; best effort, never raises. */
  provisionVirtualKey(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void>;
  /** The setup skill's prompt the empty states copy; an unknown skill throws `not_found`. */
  getSetupSkillPrompt(input: { projectId: string; skill: string }): Promise<{ body: string }>;
}

export const LangyApi = moduleApi<LangyApi>()("langy");
