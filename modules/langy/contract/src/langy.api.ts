import type { ProtocolConnection } from "@langwatch/api";
import type {
  RequestActor,
  RestResolvedProjectCredential,
  SessionKeyHolder,
  SessionKeyPresented,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authorization";
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
  LangyPanelCall,
  langyAnswerLocalPermissionInputSchema,
  langyAnswerQuestionInputSchema,
  langyClaimUiActionInputSchema,
  langyCompleteUiActionInputSchema,
  langyContinueConversationInputSchema,
  langyPanelConversationInputSchema,
  langyPanelCreateConversationInputSchema,
  langyEgressGetInputSchema,
  langyEgressSetInputSchema,
  langyEgressStateSchema,
  langyEventsAfterInputSchema,
  langyFeedbackPromptShownInputSchema,
  langyForkInputSchema,
  langyListInputSchema,
  langyProjectInputSchema,
  langyRecordFeedbackInputSchema,
  langyRenameInputSchema,
  langySetCodeAccessPreferenceInputSchema,
  langySetLocalPolicyInputSchema,
  langyStopTurnPanelInputSchema,
  langyTurnStreamInputSchema,
  langyWarmWorkerInputSchema,
} from "./langy-trpc.schemas.ts";
import type {
  LangyConversationDetailDto,
  LangyConversationEventPageDto,
  LangyConversationListPageDto,
  LangyConversationMessagesDto,
  langyConversationUpdateFrameSchema,
} from "./langy.dtos.ts";
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
  langyLocalWorkspaceStatusSchema,
} from "./langy.local-control-http.ts";
import type {
  CliFrame,
  LocalControlConnectCredentials,
  PlatformFrame,
  RegisterFrame,
} from "./langy.local-control-protocol.ts";
import type { LangyStreamEntry } from "./langy.stream-entry.ts";
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
/** One UI action the page channel serves, as `langwatch ui actions` lists it. */
export type LangyUiActionListing = Readonly<{
  kind: string;
  permission: AuthzPermission;
  backend: string | undefined;
  /** The action's payload as a draft-07 JSON Schema, inlined. */
  payloadSchema: unknown;
}>;

/** The catalogue, or the dark rollout that answers nothing. */
export type LangyUiActionsListed =
  | Readonly<{ dark: true }>
  | Readonly<{ dark: false; actions: LangyUiActionListing[] }>;

/** One dispatch as the CLI posts it: the key's caller, its resolved credential, and the body. */
export type LangyUiActionDispatchInput = LangyKeyCaller &
  Readonly<{ credential: RestResolvedProjectCredential; raw: string }>;

/** The action's own outcome, or the dark rollout that answers nothing. */
export type LangyUiActionDispatched =
  | Readonly<{ dark: true }>
  | Readonly<{ dark: false; outcome: unknown }>;

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
  /** Also settle once the turn waits on the user (a question or permission card). */
  shouldSettleOnUserWait?: boolean;
}>;

/**
 * `stopped`: the caller's signal ended the wait before the turn settled.
 * `awaiting_user`: only for a caller that opted in; `question` is the question
 * prose, empty for a permission card.
 */
export type LangyTurnSettlementWait =
  | { kind: "settled"; settlement: LangyTurnSettlement }
  | { kind: "awaiting_user"; question: string }
  | { kind: "stopped" };

export type LangyGetPageInput = {
  projectId: string;
  userId: string;
  limit: number;
  cursor?: LangyConversationListCursor;
  query?: string;
};
export type LangyGetEventsAfterInput = {
  projectId: string;
  conversationId: string;
  userId: string;
  after: { acceptedAt: number; eventId: string };
};
export type LangyFindByIdVisibleInput = {
  id: string;
  projectId: string;
  userId: string;
};
export type LangyGetAllByConversationInput = {
  conversationId: string;
  projectId: string;
  userId: string;
};
export type LangyDeleteByIdInput = { id: string; projectId: string; userId: string };
export type LangyUpdateByIdInput = {
  id: string;
  projectId: string;
  userId: string;
  title?: string | null;
  isShared?: boolean;
};
export type LangyForkByIdInput = {
  id: string;
  projectId: string;
  userId: string;
};
export type LangyWarmConversationWorkerInput = {
  projectId: string;
  session: LangyCredentialSession;
  requestedConversationId: string | null;
  modelOverride?: string;
};
export type LangyRevokeWorkerSessionKeyInput = {
  apiKeyId: string;
  projectId: string;
};
export type LangyTurnExistsInput = {
  projectId: string;
  conversationId: string;
  turnId: string;
};
export type LangyFindRunTokenInput = { projectId: string; conversationId: string };
export type LangyRecordToolCallStartedInput = {
  projectId: string;
  conversationId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  command?: string;
  input?: unknown;
};
export type LangyRecordToolCallCompletedInput = {
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
};
export type LangyRecordTurnHandoffInput = {
  projectId: string;
  conversationId: string;
  turnId: string;
  token: string;
};
export type LangyRecordPlanUpdatedInput = {
  projectId: string;
  conversationId: string;
  turnId: string;
  items: { content: string; status: string }[];
};

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
  getPage(input: LangyGetPageInput): Promise<LangyConversationListPage>;
  getEventsAfter(input: LangyGetEventsAfterInput): Promise<LangyConversationEventPage>;
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
  findByIdVisible(input: LangyFindByIdVisibleInput): Promise<LangyConversationDetail | null>;
  getById(input: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationDetail>;
  getAllByConversation(input: LangyGetAllByConversationInput): Promise<LangyMessageRow[]>;
  deleteById(input: LangyDeleteByIdInput): Promise<boolean>;
  updateById(input: LangyUpdateByIdInput): Promise<LangyConversationDetail>;
  forkById(input: LangyForkByIdInput): Promise<{ conversation: LangyConversationDetail }>;
  startConversationTurn(input: LangyStartConversationTurnInput): Promise<{
    conversationId: string;
    turnId: string;
  }>;
  /** Holds until one turn settles on the fold, or `signal` ends the wait. */
  awaitTurnSettlement(input: LangyTurnSettlementWaitInput): Promise<LangyTurnSettlementWait>;
  warmConversationWorker(
    input: LangyWarmConversationWorkerInput,
  ): Promise<{ conversationId: string | null; warmed: boolean }>;
  findModelsAllowedForProject(projectId: string): Promise<string[] | null>;
  revokeWorkerSessionKey(
    input: LangyRevokeWorkerSessionKeyInput,
  ): Promise<"revoked" | "already_revoked" | "not_found" | "refused">;
  shouldAskFeedback(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean>;
  markFeedbackShown(input: { userId: string; conversationId: string }): Promise<void>;
  turnExists(input: LangyTurnExistsInput): Promise<boolean>;
  ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void>;
  findRunToken(input: LangyFindRunTokenInput): Promise<string | null>;
  recordToolCallStarted(input: LangyRecordToolCallStartedInput): Promise<void>;
  recordToolCallCompleted(input: LangyRecordToolCallCompletedInput): Promise<void>;
  recordTurnHandoff(input: LangyRecordTurnHandoffInput): Promise<void>;
  recordPlanUpdated(input: LangyRecordPlanUpdatedInput): Promise<void>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<LangyUsageCount>;
  /** The setup skill's prompt the empty states copy; an unknown skill throws `not_found`. */
  getSetupSkillPrompt(input: { projectId: string; skill: string }): Promise<{ body: string }>;
  /** Rollout gate, then the key's owner; an unowned or unentitled key throws. */
  getRestCaller(input: LangyRestCallerInput): Promise<LangyRestCaller>;
  /** Every UI action kind this process serves, behind the UI-action rollout. */
  listUiActions(input: LangyKeyCaller): Promise<LangyUiActionsListed>;
  /**
   * Dispatches one UI action to the page the conversation's turn is attached to (or its saved
   * document when the page is away), enforcing the action's own permission as the key's ceiling.
   */
  dispatchUiAction(input: LangyUiActionDispatchInput): Promise<LangyUiActionDispatched>;
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

  // The panel's `langy.*` and `langyEgress.*` procedures, each behind the Langy rollout gate.
  listConversations(
    input: LangyPanelCall<typeof langyListInputSchema>,
  ): Promise<LangyConversationListPageDto>;
  getConversationEventsAfter(
    input: LangyPanelCall<typeof langyEventsAfterInputSchema>,
  ): Promise<LangyConversationEventPageDto>;
  /** Empty while the conversation is not visible, or not projected yet. */
  findVisibleConversationDetails(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyConversationDetailDto[]>;
  getConversationMessages(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyConversationMessagesDto>;
  archiveConversation(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ success: boolean }>;
  renameConversation(
    input: LangyPanelCall<typeof langyRenameInputSchema>,
  ): Promise<LangyConversationDetailDto>;
  forkConversation(
    input: LangyPanelCall<typeof langyForkInputSchema>,
  ): Promise<LangyConversationDetailDto>;
  createConversationTurn(
    input: LangyPanelCall<typeof langyPanelCreateConversationInputSchema>,
  ): Promise<{ conversationId: string; turnId: string }>;
  continueConversationTurn(
    input: LangyPanelCall<typeof langyContinueConversationInputSchema>,
  ): Promise<{ conversationId: string; turnId: string }>;
  stopPanelTurn(
    input: LangyPanelCall<typeof langyStopTurnPanelInputSchema>,
  ): Promise<{ stopped: boolean }>;
  warmPanelWorker(
    input: LangyPanelCall<typeof langyWarmWorkerInputSchema>,
  ): Promise<{ conversationId: string | null; warmed: boolean }>;
  getModelsAllowed(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ modelsAllowed: string[] | null }>;
  recordFeedback(input: LangyPanelCall<typeof langyRecordFeedbackInputSchema>): Promise<void>;
  markFeedbackPromptShown(
    input: LangyPanelCall<typeof langyFeedbackPromptShownInputSchema>,
  ): Promise<void>;
  watchConversationUpdates(
    input: LangyPanelCall<typeof langyProjectInputSchema> & { signal?: AbortSignal },
  ): AsyncIterable<z.infer<typeof langyConversationUpdateFrameSchema>>;
  watchTurnStream(
    input: LangyPanelCall<typeof langyTurnStreamInputSchema> & { signal?: AbortSignal },
  ): AsyncIterable<LangyStreamEntry>;
  getPanelLocalRecord(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyLocalRecord>;
  getPanelLocalWorkspace(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<z.infer<typeof langyLocalWorkspaceStatusSchema>>;
  getCodeAccessPreference(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ preference: "github" | null }>;
  setCodeAccessPreference(
    input: LangyPanelCall<typeof langySetCodeAccessPreferenceInputSchema>,
  ): Promise<{ preference: "github" | null }>;
  /** Not claimed while the conversation is not visible, or when no action is pending. */
  claimUiAction(
    input: LangyPanelCall<typeof langyClaimUiActionInputSchema>,
  ): Promise<{ isClaimed: boolean }>;
  completeUiAction(
    input: LangyPanelCall<typeof langyCompleteUiActionInputSchema>,
  ): Promise<{ isAccepted: boolean }>;
  answerLocalPermission(
    input: LangyPanelCall<typeof langyAnswerLocalPermissionInputSchema>,
  ): Promise<{ answered: true }>;
  answerLocalQuestion(
    input: LangyPanelCall<typeof langyAnswerQuestionInputSchema>,
  ): Promise<{ answered: true }>;
  setLocalPolicy(
    input: LangyPanelCall<typeof langySetLocalPolicyInputSchema>,
  ): Promise<{ skipPermissions: boolean }>;
  disconnectLocalWorkspace(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ disconnected: boolean }>;
  renewLocalControlRequest(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ expiresAt: string }>;
  getEgressState(
    input: LangyPanelCall<typeof langyEgressGetInputSchema>,
  ): Promise<z.infer<typeof langyEgressStateSchema>>;
  setEgressState(
    input: LangyPanelCall<typeof langyEgressSetInputSchema>,
  ): Promise<z.infer<typeof langyEgressStateSchema>>;
}

export const LangyApi = moduleApi<LangyApi>()("langy");
