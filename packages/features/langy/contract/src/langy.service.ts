import type {
  LangyConversation,
  LangyConversationInput,
  LangyConversationListInput,
  LangyConversationPage,
  LangyCreateConversationInput,
  LangyCredential,
  LangyCredentialInput,
  LangyEgressAllowlist,
  LangyEgressProjectInput,
  LangyCredentialSession,
  LangyRelayFrame,
  LangyStopTurnInput,
  LangyTurnInput,
  LangyCredentials,
  LangyMirrorTier,
} from "./langy";
import type { LangyMessagePart } from "./json";
import type { LangyConversationTurnWireEvent } from "./event-sourcing/contracts/turnWire";
import type { LangyEventCursor } from "./event-sourcing/contracts/cursor";

export type LangyConversationListItem = {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  lastActivityAt: Date;
  messageCount: number;
};

export type LangyConversationDetail = LangyConversationListItem & {
  status: string;
  currentTurnId: string | null;
  lastError: string | null;
  lastModel: string | null;
  eventCursor: LangyEventCursor | null;
};

export type LangyConversationListCursor = {
  lastActivityAtMs: number | null;
  id: string;
};

export type LangyConversationListPage = {
  items: LangyConversationListItem[];
  nextCursor: LangyConversationListCursor | null;
};

export type LangyMessageRow = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  parts: unknown[];
  createdAt: Date;
};

export type LangyConversationEventPage = {
  events: LangyConversationTurnWireEvent[];
  cursor: LangyEventCursor;
  truncated: boolean;
};

export type LangyStartConversationTurnInput = {
  projectId: string;
  idempotencyKey: string;
  session: LangyCredentialSession;
  requestedConversationId: string | null;
  adoptConversationId?: boolean;
  messages: Array<{ role: "user" | "assistant" | "system"; parts: unknown[] }>;
  modelOverride?: string;
  isRetry: boolean;
  turnContext: object;
};

export type LangyTurnResultInput = {
  projectId: string;
  conversationId: string;
  turnId: string;
  status: "completed" | "failed";
  text?: string;
  toolCalls?: unknown[];
  errorCode?: string;
};

export type LangyConversationTurnCapability = {
  ensureConversation(input: {
    projectId: string;
    userId: string;
    conversationId?: string | null;
    adoptUnknownId?: boolean;
  }): Promise<{ id: string; isNew: boolean }>;
  tryFindByIdVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ isOwn: boolean; currentTurnId: string | null; status: string } | null>;
  tryGetPendingHandoff(input: {
    projectId: string;
    conversationId: string;
  }): Promise<{ token: string; turnId: string } | null>;
  tryGetRunToken(input: {
    projectId: string;
    conversationId: string;
  }): Promise<string | null>;
  acceptTurn(input: {
    projectId: string;
    conversationId: string;
    turnId?: string;
    questionParts?: LangyMessagePart[];
    model?: string;
    conversationStart?: object;
    userMessage?: object;
    consumeHandoffTurnId?: string;
  }): Promise<{ turnId: string }>;
  finalizeTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    parts: LangyMessagePart[];
    outcome?: "completed" | "failed" | "stopped";
    error?: string | null;
  }): Promise<{ messageId: string }>;
};

export type LangyCredentialTurnCapability = {
  getOrProvision(input: {
    projectId: string;
    session: LangyCredentialSession;
    mintSessionKey?: boolean;
  }): Promise<LangyCredentials>;
  tryGetEgressAllowlist(input: { projectId: string }): Promise<string[] | null>;
  resolveMirrorTier(input: { projectId: string }): Promise<LangyMirrorTier>;
  tryGetModelsAllowed(input: { projectId: string; organizationId: string }): Promise<string[] | null>;
};

export type LangyMessageTurnCapability = {
  findAllByConversation(input: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]>;
};

export type LangyTurnAdmissionClaim =
  | { kind: "claimed"; claimToken: string; conversationId: string; turnId: string }
  | { kind: "replay"; conversationId: string; turnId: string }
  | { kind: "pending" }
  | { kind: "busy" }
  | { kind: "mismatch" };

export type LangyTurnAdmissionCapability = {
  claim(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnAdmissionClaim>;
  commit(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
    claimToken: string;
  }): Promise<void>;
  abort(input: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    conversationId: string;
    turnId: string;
    claimToken: string;
  }): Promise<void>;
  confirmAccepted(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<void>;
  release(input: {
    projectId: string;
    conversationId: string;
    turnId?: string;
  }): Promise<void>;
};

/** The one cross-feature Langy capability. Transports must delegate to this. */
export abstract class LangyService {
  abstract listConversations(
    input: LangyConversationListInput,
  ): Promise<LangyConversationPage>;

  abstract getConversation(
    input: LangyConversationInput,
  ): Promise<LangyConversation>;

  abstract createConversation(
    input: LangyCreateConversationInput,
  ): Promise<LangyConversation>;

  abstract archiveConversation(input: LangyConversationInput): Promise<void>;

  abstract startTurn(
    input: LangyTurnInput,
  ): Promise<{ conversation: LangyConversation; turnId: string }>;

  abstract stopTurn(input: LangyStopTurnInput & { userId: string }): Promise<void>;

  abstract listMessages(
    input: LangyConversationInput,
  ): Promise<readonly unknown[]>;

  abstract resolveCredential(
    input: LangyCredentialInput,
  ): Promise<LangyCredential>;

  abstract tryGetEgressAllowlist(
    input: LangyEgressProjectInput,
  ): Promise<LangyEgressAllowlist | null>;

  abstract trySetEgressAllowlist(
    input: LangyEgressProjectInput & { allowlist: LangyEgressAllowlist },
  ): Promise<LangyEgressAllowlist | null>;

  abstract relay(frame: LangyRelayFrame): Promise<void>;

  abstract getPage(input: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationListPage>;
  abstract getEventsAfter(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: LangyEventCursor;
  }): Promise<LangyConversationEventPage>;
  abstract tryFindByIdVisible(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail | null>;
  abstract getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail>;
  abstract getAllByConversation(input: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<LangyMessageRow[]>;
  abstract deleteById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean>;
  abstract updateById(input: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }): Promise<LangyConversationDetail>;
  abstract forkById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{ conversation: LangyConversationDetail }>;
  abstract startConversationTurn(
    input: LangyStartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }>;
  abstract warmConversationWorker(input: {
    projectId: string;
    session: LangyCredentialSession;
    requestedConversationId: string | null;
    modelOverride?: string;
  }): Promise<{ conversationId: string | null; warmed: boolean }>;
  abstract tryGetModelsAllowedForProject(
    projectId: string,
  ): Promise<string[] | null>;
  abstract shouldAskFeedback(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean>;
  abstract markFeedbackShown(input: {
    userId: string;
    conversationId: string;
  }): Promise<void>;
  abstract turnExists(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean>;
  abstract ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void>;
  abstract tryGetRunToken(input: {
    projectId: string;
    conversationId: string;
  }): Promise<string | null>;
  abstract recordToolCallStarted(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    command?: string;
    input?: unknown;
  }): Promise<void>;
  abstract recordToolCallCompleted(input: {
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
  abstract recordTurnHandoff(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void>;
  abstract recordPlanUpdated(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
  }): Promise<void>;
}
