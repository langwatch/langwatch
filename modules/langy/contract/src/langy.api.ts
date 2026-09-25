import type { ProtocolConnection } from "@langwatch/api";
import type { RequestActor, SessionKeyHolder, SessionKeyPresented } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { z } from "zod";

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
import type {
  langyControlCancelResultSchema,
  langyLocalStartCallRequestSchema,
  langyLocalStartWaitRequestSchema,
  RelayTally,
} from "./langy-rest.schemas.ts";
import type {
  ApproveControlRequestResponse,
  CreateControlRequestResponse,
  ListControlRequestsResponse,
  LangyLocalCallCancelled,
  PollCallResponse,
  PollWaitResponse,
  StartCallResponse,
  StartWaitResponse,
  WorkspaceStatus,
} from "./langy.local-control-http.ts";
import type {
  CliFrame,
  LocalControlConnectCredentials,
  PlatformFrame,
  RegisterFrame,
} from "./langy.local-control-protocol.ts";
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

/** A public Langy REST surface, each behind its own per-project rollout. */
export type LangyRestSurface = "turns" | "ui_actions";

/** The key's owner behind a public surface, or the dark rollout that answers nothing. */
export type LangyRestCaller =
  | Readonly<{ dark: true }>
  | Readonly<{ dark: false; projectId: string; userId: string }>;

/** The owner of a local worker's key, with the project facts its links name. */
export type LangyLocalCaller = Readonly<{
  userId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
}>;

/** Who the project door put behind a key (its owner, or none), and the project it resolved. */
export type LangyKeyCaller = Readonly<{
  actor: RequestActor | null;
  projectId: string;
}>;

/** A local worker's key, and the conversation it names. */
export type LangyLocalConversationInput = LangyKeyCaller & Readonly<{ conversationId: string }>;
export type LangyLocalStartCallInput = LangyKeyCaller &
  Readonly<{ call: z.infer<typeof langyLocalStartCallRequestSchema> }>;
export type LangyLocalStartWaitInput = LangyKeyCaller &
  Readonly<{ wait: z.infer<typeof langyLocalStartWaitRequestSchema> }>;
/** A long-poll read holds until the record settles or the caller hangs up. */
export type LangyLocalCallInput = LangyKeyCaller &
  Readonly<{ callId: string; signal?: AbortSignal }>;
export type LangyLocalWaitInput = LangyKeyCaller &
  Readonly<{ waitId: string; signal?: AbortSignal }>;
/** The terminal's key owner (none for a key no person owns), and the request it addresses. */
export type LangyControlOwnerInput = Readonly<{ actor: RequestActor | null }>;
export type LangyControlRequestInput = LangyControlOwnerInput & Readonly<{ requestId: string }>;
export type LangyControlRequestCancelled = z.infer<typeof langyControlCancelResultSchema>;
/** A public surface's caller: the key's owner and project, and which surface's rollout gates it. */
export type LangyControlRegisterInput = LangyKeyCaller &
  Readonly<{ authorization: string; frame: RegisterFrame }>;
export type LangyControlRegistered = Readonly<{ frame: PlatformFrame; instanceToken: string }>;
export type LangyControlPollInput = Readonly<{
  instanceToken: string;
  inFlightCallIds: readonly string[];
  signal?: AbortSignal;
}>;
export type LangyControlFramesInput = Readonly<{ instanceToken: string; frames: CliFrame[] }>;
export type LangyRestCallerInput = LangyKeyCaller & Readonly<{ surface: LangyRestSurface }>;

/** How one turn settled: its reply text, or why it failed. */
export type LangyTurnSettlement =
  | { succeeded: true; outcome: "completed" | "stopped"; text: string; error: null }
  | { succeeded: false; outcome: "failed"; text: null; error: string };

/** One turn a caller holds for; `signal` is the caller's deadline and disconnect. */
export type LangyTurnSettlementWaitInput = Readonly<{
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  signal: AbortSignal;
}>;

/** `stopped`: the caller's signal ended the wait before the turn settled. */
export type LangyTurnSettlementWait =
  | { kind: "settled"; settlement: LangyTurnSettlement }
  | { kind: "stopped" };

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
  /** Holds until one turn settles on the fold, or `signal` ends the wait. */
  awaitTurnSettlement(input: LangyTurnSettlementWaitInput): Promise<LangyTurnSettlementWait>;
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
  /** Rollout gate, then the key's owner; an unowned or unentitled key throws. */
  getRestCaller(input: LangyRestCallerInput): Promise<LangyRestCaller>;
  /** The person an owner's turns are filed under; a missing one throws. */
  getRestActor(input: { userId: string }): Promise<LangyCredentialSession>;
  /** The owner of a local worker's key, proved against Langy access. */
  getLocalCaller(input: LangyKeyCaller): Promise<LangyLocalCaller>;
  /** The code access card's status for the key owner's own conversation. */
  getLocalWorkspace(input: LangyLocalConversationInput): Promise<WorkspaceStatus>;
  createLocalControlRequest(
    input: LangyLocalConversationInput,
  ): Promise<CreateControlRequestResponse>;
  startLocalCall(input: LangyLocalStartCallInput): Promise<StartCallResponse>;
  /** Holds until the call settles; a lapsed or foreign call throws not found. */
  getLocalCallAnswer(input: LangyLocalCallInput): Promise<PollCallResponse>;
  cancelLocalCall(input: LangyLocalCallInput): Promise<LangyLocalCallCancelled>;
  startLocalWait(input: LangyLocalStartWaitInput): Promise<StartWaitResponse>;
  /** Holds until the question is answered; a lapsed or foreign wait throws not found. */
  getLocalWaitAnswer(input: LangyLocalWaitInput): Promise<PollWaitResponse>;
  /** The key owner's open requests on every project they can read; no owner refuses. */
  listLocalControlRequests(input: LangyControlOwnerInput): Promise<ListControlRequestsResponse>;
  /** Approves one addressed request, answering its session key once. */
  approveLocalControlRequest(
    input: LangyControlRequestInput,
  ): Promise<ApproveControlRequestResponse>;
  cancelLocalControlRequest(input: LangyControlRequestInput): Promise<LangyControlRequestCancelled>;
  /** The session-key door's check: who holds a minted key; any other key throws its refusal. */
  verifyLocalControlSessionKey(presented: SessionKeyPresented): Promise<SessionKeyHolder>;
  /** Shares a folder over long-poll: the registered frame and the token its polls carry. */
  registerLocalControlSession(input: LangyControlRegisterInput): Promise<LangyControlRegistered>;
  /** Holds until the folder has frames; an unknown instance token throws not found. */
  pollLocalControlSession(input: LangyControlPollInput): Promise<{ frames: PlatformFrame[] }>;
  /** Takes the folder's frames; an unknown instance token throws not found. */
  postLocalControlFrames(input: LangyControlFramesInput): Promise<{ accepted: number }>;
  /** Holds one folder's socket from its register frame until it closes; refusals are frames. */
  acceptLocalControlConnection(
    connection: ProtocolConnection,
    credentials: LocalControlConnectCredentials,
  ): Promise<void>;
}

export const LangyApi = moduleApi<LangyApi>()("langy");
