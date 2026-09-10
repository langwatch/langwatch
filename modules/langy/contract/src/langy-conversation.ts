import type { LangyCredentialSession, LangyCredentials, LangyMirrorTier } from "./langy.ts";
import type { LangyMessagePart } from "./json.ts";
import type { CliResultDigest } from "./cards/digest.ts";
import type { CliToolResult } from "./cards/tool-result.ts";
import type { LangyConversationTurnWireEvent } from "./event-sourcing/contracts/turn-wire.ts";
import type { LangyEventCursor } from "./event-sourcing/contracts/cursor.ts";
import type { Instant } from "@langwatch/time";

export type LangyConversationListItem = {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  lastActivityAt: Instant;
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
  createdAt: Instant;
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
  messages: Array<{
    role: "user" | "assistant" | "system";
    parts: LangyMessagePart[];
  }>;
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
  toolCalls?: LangyFinalToolCall[];
  errorCode?: string;
};

export type LangyFinalToolCall = {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  digest?: CliResultDigest;
  result?: CliToolResult;
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
  tryGetRunToken(input: { projectId: string; conversationId: string }): Promise<string | null>;
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
  tryGetModelsAllowed(input: {
    projectId: string;
    organizationId: string;
  }): Promise<string[] | null>;
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

export type LangyRelayRejection =
  | "malformed-envelope"
  | "no-run-token"
  | "bad-signature"
  | "wrong-turn"
  | "invalid-payload";

export type LangyRelayOutcome =
  | { status: "applied" }
  | { status: "terminal" }
  | { status: "duplicate" }
  | { status: "rejected"; reason: LangyRelayRejection };

export type LangyRelayConnection = {
  readonly pinnedTurn: {
    projectId: string;
    conversationId: string;
    turnId: string;
  } | null;
  handle(raw: unknown): Promise<LangyRelayOutcome>;
};

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
  release(input: { projectId: string; conversationId: string; turnId?: string }): Promise<void>;
};
