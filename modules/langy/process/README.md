# @langwatch/langy-process

The server half of [langy](../README.md). Langy, the in-product assistant: conversations, turns, messages, credentials and relay frames, and the pipeline that carries a turn to the agent and back.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("langy").withRepositories(langyRepositories).withChannels(langyChannels).withApi(LangyModule).withTransports(langyTurnsRest, langyUiActionsRest, langyInternalRest, langyLocalRest, langyLocalControlRest, langyLocalControlConnectRest, ...langyLocalControlDatedRests, ...langyLocalControlConnectDatedRests, …, setupSkillsTrpcTransport, langyTrpcTransport, langyEgressTrpcTransport).withTransportFacts(…).withEventing(langyConversationEventing).withEventing(langyGuidedOnboardingEventing).withEventing(langyMaintenanceEventing)`, `src/langy.module.ts:28`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`LangyApi`)

The portable, callable Langy capability shared by process transports.

Peers call these through the token, declared at `../contract/src/langy.api.ts:299`; nothing else in this package is public.

#### `ingestInternalTurnResult`

```typescript
ingestInternalTurnResult(input: LangyTurnResultInput): Promise<{ status: "accepted" }>;
```

#### `revokeInternalCredentials`

```typescript
revokeInternalCredentials(input: { apiKeyId: string; projectId: string; }): Promise<{ outcome: "revoked" | "already_revoked" }>;
```

#### `receiveInternalFrames`

```typescript
receiveInternalFrames(body: ReadableStream<Uint8Array> | null): Promise<RelayTally>;
```

#### `stopTurn`

```typescript
stopTurn(input: LangyStopTurnInput & { userId: string }): Promise<void>;
```

#### `findEgressAllowlist`

```typescript
findEgressAllowlist(input: { projectId: string }): Promise<LangyEgressAllowlist | null>;
```

#### `openRelayConnection`

```typescript
openRelayConnection(): LangyRelayConnection;
```

#### `getPage`

```typescript
getPage(input: LangyGetPageInput): Promise<LangyConversationListPage>;
```

#### `getEventsAfter`

```typescript
getEventsAfter(input: LangyGetEventsAfterInput): Promise<LangyConversationEventPage>;
```

#### `recordUserMessage`

```typescript
recordUserMessage(input: { projectId: string; conversationId: string; userId: string; parts: jsonModule.LangyMessagePart[]; title?: string | null; role?: jsonModule.LangyMessageRole; messageId?: string; }): Promise<{ messageId: string }>;
```

#### `getLocalRecord`

```typescript
getLocalRecord(input: { projectId: string; conversationId: string; userId: string; }): Promise<LangyLocalRecord>;
```

#### `findByIdVisible`

```typescript
findByIdVisible(input: LangyFindByIdVisibleInput): Promise<LangyConversationDetail | null>;
```

#### `getById`

```typescript
getById(input: { id: string; projectId: string; userId: string; }): Promise<LangyConversationDetail>;
```

#### `getAllByConversation`

```typescript
getAllByConversation(input: LangyGetAllByConversationInput): Promise<LangyMessageRow[]>;
```

#### `deleteById`

```typescript
deleteById(input: LangyDeleteByIdInput): Promise<boolean>;
```

#### `updateById`

```typescript
updateById(input: LangyUpdateByIdInput): Promise<LangyConversationDetail>;
```

#### `forkById`

```typescript
forkById(input: LangyForkByIdInput): Promise<{ conversation: LangyConversationDetail }>;
```

#### `startConversationTurn`

```typescript
startConversationTurn(input: LangyStartConversationTurnInput): Promise<{ conversationId: string; turnId: string; }>;
```

#### `startUnattendedTurn`

Starts a read-only turn as the person, in a new conversation marked as a run: view permissions only, as they hold them now, and no GitHub token. A missing person, one without Langy access or one with nothing to read with is refused, and nothing starts.

```typescript
startUnattendedTurn(input: LangyStartUnattendedTurnInput): Promise<{ conversationId: string; turnId: string; }>;
```

#### `awaitTurnSettlement`

Holds until one turn settles on the fold, or `signal` ends the wait.

```typescript
awaitTurnSettlement(input: LangyTurnSettlementWaitInput): Promise<LangyTurnSettlementWait>;
```

#### `warmConversationWorker`

```typescript
warmConversationWorker(input: LangyWarmConversationWorkerInput): Promise<{ conversationId: string | null; warmed: boolean }>;
```

#### `findModelsAllowedForProject`

```typescript
findModelsAllowedForProject(projectId: string): Promise<string[] | null>;
```

#### `revokeWorkerSessionKey`

```typescript
revokeWorkerSessionKey(input: LangyRevokeWorkerSessionKeyInput): Promise<"revoked" | "already_revoked" | "not_found" | "refused">;
```

#### `shouldAskFeedback`

```typescript
shouldAskFeedback(input: { userId: string; conversationId: string; assistantAnswerCount: number; }): Promise<boolean>;
```

#### `markFeedbackShown`

```typescript
markFeedbackShown(input: { userId: string; conversationId: string }): Promise<void>;
```

#### `turnExists`

```typescript
turnExists(input: LangyTurnExistsInput): Promise<boolean>;
```

#### `ingestAgentTurnResult`

```typescript
ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void>;
```

#### `findRunToken`

```typescript
findRunToken(input: LangyFindRunTokenInput): Promise<string | null>;
```

#### `recordToolCallStarted`

```typescript
recordToolCallStarted(input: LangyRecordToolCallStartedInput): Promise<void>;
```

#### `recordToolCallCompleted`

```typescript
recordToolCallCompleted(input: LangyRecordToolCallCompletedInput): Promise<void>;
```

#### `recordTurnHandoff`

```typescript
recordTurnHandoff(input: LangyRecordTurnHandoffInput): Promise<void>;
```

#### `recordPlanUpdated`

```typescript
recordPlanUpdated(input: LangyRecordPlanUpdatedInput): Promise<void>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<LangyUsageCount>;
```

#### `getSetupSkillPrompt`

The setup skill's prompt the empty states copy; an unknown skill throws `not_found`.

```typescript
getSetupSkillPrompt(input: { projectId: string; skill: string }): Promise<{ body: string }>;
```

#### `getRestCaller`

Rollout gate, then the key's owner; an unowned or unentitled key throws.

```typescript
getRestCaller(input: LangyRestCallerInput): Promise<LangyRestCaller>;
```

#### `listUiActions`

Every UI action kind this process serves, behind the UI-action rollout.

```typescript
listUiActions(input: LangyKeyCaller): Promise<LangyUiActionsListed>;
```

#### `dispatchUiAction`

Dispatches one UI action to the page the conversation's turn is attached to (or its saved document when the page is away), enforcing the action's own permission as the key's ceiling.

```typescript
dispatchUiAction(input: LangyUiActionDispatchInput): Promise<LangyUiActionDispatched>;
```

#### `getRestActor`

The person an owner's turns are filed under; a missing one throws.

```typescript
getRestActor(input: { userId: string }): Promise<LangyCredentialSession>;
```

#### `getLocalCaller`

The owner of a local worker's key, proved against Langy access.

```typescript
getLocalCaller(input: LangyKeyCaller): Promise<LangyLocalCaller>;
```

#### `getLocalWorkspace`

The code access card's status for the key owner's own conversation.

```typescript
getLocalWorkspace(input: LangyLocalConversationInput): Promise<WorkspaceStatus>;
```

#### `createLocalControlRequest`

```typescript
createLocalControlRequest(input: LangyLocalConversationInput): Promise<CreateControlRequestResponse>;
```

#### `startLocalCall`

```typescript
startLocalCall(input: LangyLocalStartCallInput): Promise<StartCallResponse>;
```

#### `getLocalCallAnswer`

Holds until the call settles; a lapsed or foreign call throws not found.

```typescript
getLocalCallAnswer(input: LangyLocalCallInput): Promise<PollCallResponse>;
```

#### `cancelLocalCall`

```typescript
cancelLocalCall(input: LangyLocalCallInput): Promise<LangyLocalCallCancelled>;
```

#### `startLocalWait`

```typescript
startLocalWait(input: LangyLocalStartWaitInput): Promise<StartWaitResponse>;
```

#### `getLocalWaitAnswer`

Holds until the question is answered; a lapsed or foreign wait throws not found.

```typescript
getLocalWaitAnswer(input: LangyLocalWaitInput): Promise<PollWaitResponse>;
```

#### `listLocalControlRequests`

The key owner's open requests on every project they can read; no owner refuses.

```typescript
listLocalControlRequests(input: LangyControlOwnerInput): Promise<ListControlRequestsResponse>;
```

#### `approveLocalControlRequest`

Approves one addressed request, answering its session key once.

```typescript
approveLocalControlRequest(input: LangyControlRequestInput): Promise<ApproveControlRequestResponse>;
```

#### `cancelLocalControlRequest`

```typescript
cancelLocalControlRequest(input: LangyControlRequestInput): Promise<LangyControlRequestCancelled>;
```

#### `verifyLocalControlSessionKey`

The session-key door's check: who holds a minted key; any other key throws its refusal.

```typescript
verifyLocalControlSessionKey(presented: SessionKeyPresented): Promise<LocalControlKeyHolder>;
```

#### `registerLocalControlSession`

Shares a folder over long-poll: the registered frame and the token its polls carry.

```typescript
registerLocalControlSession(input: LangyControlRegisterInput): Promise<LangyControlRegistered>;
```

#### `pollLocalControlSession`

Holds until the folder has frames; an unknown instance token throws not found.

```typescript
pollLocalControlSession(input: LangyControlPollInput): Promise<{ frames: PlatformFrame[] }>;
```

#### `postLocalControlFrames`

Takes the folder's frames; an unknown instance token throws not found.

```typescript
postLocalControlFrames(input: LangyControlFramesInput): Promise<{ accepted: number }>;
```

#### `acceptLocalControlConnection`

Holds one folder's socket from its register frame until it closes; refusals are frames.

```typescript
acceptLocalControlConnection(connection: ProtocolConnection, opened: LocalControlConnectionOpened): Promise<void>;
```

#### `listConversations`

```typescript
listConversations(input: LangyPanelCall<typeof langyListInputSchema>): Promise<LangyConversationListPageDto>;
```

#### `getConversationEventsAfter`

```typescript
getConversationEventsAfter(input: LangyPanelCall<typeof langyEventsAfterInputSchema>): Promise<LangyConversationEventPageDto>;
```

#### `findVisibleConversationDetails`

Empty while the conversation is not visible, or not projected yet.

```typescript
findVisibleConversationDetails(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<LangyConversationDetailDto[]>;
```

#### `getConversationMessages`

```typescript
getConversationMessages(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<LangyConversationMessagesDto>;
```

#### `archiveConversation`

```typescript
archiveConversation(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<{ success: boolean }>;
```

#### `renameConversation`

```typescript
renameConversation(input: LangyPanelCall<typeof langyRenameInputSchema>): Promise<LangyConversationDetailDto>;
```

#### `forkConversation`

```typescript
forkConversation(input: LangyPanelCall<typeof langyForkInputSchema>): Promise<LangyConversationDetailDto>;
```

#### `createConversationTurn`

```typescript
createConversationTurn(input: LangyPanelCall<typeof langyPanelCreateConversationInputSchema>): Promise<{ conversationId: string; turnId: string }>;
```

#### `continueConversationTurn`

```typescript
continueConversationTurn(input: LangyPanelCall<typeof langyContinueConversationInputSchema>): Promise<{ conversationId: string; turnId: string }>;
```

#### `stopPanelTurn`

```typescript
stopPanelTurn(input: LangyPanelCall<typeof langyStopTurnPanelInputSchema>): Promise<{ stopped: boolean }>;
```

#### `warmPanelWorker`

```typescript
warmPanelWorker(input: LangyPanelCall<typeof langyWarmWorkerInputSchema>): Promise<{ conversationId: string | null; warmed: boolean }>;
```

#### `getModelsAllowed`

```typescript
getModelsAllowed(input: LangyPanelCall<typeof langyProjectInputSchema>): Promise<{ modelsAllowed: string[] | null }>;
```

#### `recordFeedback`

```typescript
recordFeedback(input: LangyPanelCall<typeof langyRecordFeedbackInputSchema>): Promise<void>;
```

#### `markFeedbackPromptShown`

```typescript
markFeedbackPromptShown(input: LangyPanelCall<typeof langyFeedbackPromptShownInputSchema>): Promise<void>;
```

#### `watchConversationUpdates`

```typescript
watchConversationUpdates(input: LangyPanelCall<typeof langyProjectInputSchema> & { signal?: AbortSignal }): AsyncIterable<z.infer<typeof langyConversationUpdateFrameSchema>>;
```

#### `watchTurnStream`

```typescript
watchTurnStream(input: LangyPanelCall<typeof langyTurnStreamInputSchema> & { signal?: AbortSignal }): AsyncIterable<LangyStreamEntry>;
```

#### `getPanelLocalRecord`

```typescript
getPanelLocalRecord(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<LangyLocalRecord>;
```

#### `getPanelLocalWorkspace`

```typescript
getPanelLocalWorkspace(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<z.infer<typeof langyLocalWorkspaceStatusSchema>>;
```

#### `getCodeAccessPreference`

```typescript
getCodeAccessPreference(input: LangyPanelCall<typeof langyProjectInputSchema>): Promise<{ preference: "github" | null }>;
```

#### `setCodeAccessPreference`

```typescript
setCodeAccessPreference(input: LangyPanelCall<typeof langySetCodeAccessPreferenceInputSchema>): Promise<{ preference: "github" | null }>;
```

#### `claimUiAction`

Not claimed while the conversation is not visible, or when no action is pending.

```typescript
claimUiAction(input: LangyPanelCall<typeof langyClaimUiActionInputSchema>): Promise<{ isClaimed: boolean }>;
```

#### `completeUiAction`

```typescript
completeUiAction(input: LangyPanelCall<typeof langyCompleteUiActionInputSchema>): Promise<{ isAccepted: boolean }>;
```

#### `answerLocalPermission`

```typescript
answerLocalPermission(input: LangyPanelCall<typeof langyAnswerLocalPermissionInputSchema>): Promise<{ answered: true }>;
```

#### `answerLocalQuestion`

```typescript
answerLocalQuestion(input: LangyPanelCall<typeof langyAnswerQuestionInputSchema>): Promise<{ answered: true }>;
```

#### `setLocalPolicy`

```typescript
setLocalPolicy(input: LangyPanelCall<typeof langySetLocalPolicyInputSchema>): Promise<{ skipPermissions: boolean }>;
```

#### `disconnectLocalWorkspace`

```typescript
disconnectLocalWorkspace(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<{ disconnected: boolean }>;
```

#### `renewLocalControlRequest`

```typescript
renewLocalControlRequest(input: LangyPanelCall<typeof langyPanelConversationInputSchema>): Promise<{ expiresAt: string }>;
```

#### `getEgressState`

```typescript
getEgressState(input: LangyPanelCall<typeof langyEgressGetInputSchema>): Promise<z.infer<typeof langyEgressStateSchema>>;
```

#### `setEgressState`

```typescript
setEgressState(input: LangyPanelCall<typeof langyEgressSetInputSchema>): Promise<z.infer<typeof langyEgressStateSchema>>;
```

## REST transport

### `langyInternalRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/langy-internal.rest.ts:16` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | project                                   |

#### `POST /api/internal/langy/turn/:turnId/result` · `ingestTurnResult`

Authenticated: the caller is the deployment's own Langy service, not a tenant; its shared bearer is the whole gate and no RBAC grain applies. Credential `internal_secret`. Declared at `src/transport/langy-internal.rest.ts:21`.

Answers at `/api/internal/langy/turn/:turnId/result`.

```typescript
// Params: langyInternalTurnParamsSchema, ../contract/src/langy-rest.schemas.ts:53
interface Params {
  turnId: string;
}
type Body = z.infer<typeof langyTurnResultSchema>; // ../contract/src/langy-rest.schemas.ts:37
// Response: langyInternalAcceptedSchema, ../contract/src/langy-rest.schemas.ts:56
interface Response {
  status: "accepted";
}
```

#### `POST /api/internal/langy/credentials/revoke` · `revokeWorkerSessionKey`

Authenticated: the caller is the deployment's own Langy service, not a tenant; its shared bearer is the whole gate and no RBAC grain applies. Credential `internal_secret`. Declared at `src/transport/langy-internal.rest.ts:30`.

Answers at `/api/internal/langy/credentials/revoke`.

```typescript
// Body: langyRevokeCredentialsSchema, ../contract/src/langy-rest.schemas.ts:66
interface Body {
  apiKeyId: string;
  projectId: string;
}
// Response: langyInternalRevokedSchema, ../contract/src/langy-rest.schemas.ts:59
interface Response {
  outcome: "revoked" | "already_revoked" | "not_found";
}
```

#### `POST /api/internal/langy/relay/frames` · `streamRelayFrames`

Authenticated: the caller is the deployment's own Langy service, not a tenant; its shared bearer is the whole gate and no RBAC grain applies. Credential `internal_secret`. Declared at `src/transport/langy-internal.rest.ts:37`.

Answers at `/api/internal/langy/relay/frames`.

```typescript
// Rawbody: "stream" (inline, src/transport/langy-internal.rest.ts:41)
// Response: langyRelayTallySchema, ../contract/src/langy-rest.schemas.ts:200
interface Response {
  applied: number;
  duplicate: number;
  rejected: number;
  terminal: boolean;
}
```

### `localControlConnectRest`

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| Declared at | `src/transport/langy-local-control-connect.rest.ts:57` |
| Base URL    | ≈ namespace `langy`                                    |
| Addressing  | literal                                                |
| Credential  | project                                                |

#### `POST ≈ `/api/langy/control${mount}/connect/register`` · `langyControlConnectRegister`

Authenticated: a Langy session key is minted for one conversation and holds no RBAC permission; the key is the whole grant. Credential `session_key`. Declared at `src/transport/langy-local-control-connect.rest.ts:63`.

```typescript
type Body = z.infer<typeof registerFrameSchema>; // ../contract/src/features/local-control/langy.local-control-protocol.ts:158
// Response: inline, src/transport/langy-local-control-connect.rest.ts:72
type Response = unknown;
```

#### `GET ≈ `/api/langy/control${mount}/connect/poll`` · `langyControlConnectPoll`

Public: addressed by the pod-local instance token register handed out, as on main; the session key is checked once, at register. Declared at `src/transport/langy-local-control-connect.rest.ts:100`.

```typescript
// Query: langyControlPollQuerySchema, ../contract/src/langy-rest.schemas.ts:148
interface Query {
  inFlight?: string;
}
type Headers = z.infer<typeof instanceTokenHeaders>; // src/transport/langy-local-control-connect.rest.ts:54
// Response: inline, src/transport/langy-local-control-connect.rest.ts:104
type Response = unknown;
```

#### `POST ≈ `/api/langy/control${mount}/connect/frames`` · `langyControlConnectFrames`

Public: addressed by the pod-local instance token register handed out, as on main; the session key is checked once, at register. Declared at `src/transport/langy-local-control-connect.rest.ts:131`.

```typescript
type Body = z.infer<typeof langyControlFramesBodySchema>; // ../contract/src/langy-rest.schemas.ts:136
type Headers = z.infer<typeof instanceTokenHeaders>; // src/transport/langy-local-control-connect.rest.ts:54
// Response: inline, src/transport/langy-local-control-connect.rest.ts:135
type Response = unknown;
```

### `localControlRest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/langy-local-control.rest.ts:34` |
| Base URL    | ≈ namespace `langy`                            |
| Addressing  | literal                                        |
| Credential  | project                                        |

#### `GET ≈ `/api/langy/control${mount}/requests`` · `listLangyControlRequests`

Permission `langy:view`. Declared at `src/transport/langy-local-control.rest.ts:40`.

```typescript
// Response: listControlRequestsResponseSchema, ../contract/src/features/local-control/langy.local-control-http.ts:29
interface Response {
  requests: {
    id: string;
    conversationId: string;
    conversationTitle: string;
    conversationUrl: string;
    projectId: string;
    projectName: string;
    createdAt: string;
    expiresAt: string;
  }[];
}
```

#### `POST ≈ `/api/langy/control${mount}/requests/:requestId/approve`` · `approveLangyControlRequest`

Permission `langy:create`. Declared at `src/transport/langy-local-control.rest.ts:53`.

```typescript
// Params: langyControlIdParamsSchema, ../contract/src/langy-rest.schemas.ts:108
interface Params {
  requestId: string;
}
type Body = z.infer<typeof approveControlRequestBodySchema>; // ../contract/src/features/local-control/langy.local-control-http.ts:38
// Response: approveControlRequestResponseSchema, ../contract/src/features/local-control/langy.local-control-http.ts:42
interface Response {
  sessionKey: string;
  endpoint: string;
  conversation: {
    id: string;
    title: string;
    url: string;
  };
}
```

#### `POST ≈ `/api/langy/control${mount}/requests/:requestId/cancel`` · `cancelLangyControlRequest`

Permission `langy:create`. Declared at `src/transport/langy-local-control.rest.ts:70`.

```typescript
type Params = z.infer<typeof langyControlIdParamsSchema>; // ../contract/src/langy-rest.schemas.ts:108
// Body: controlActionBodySchema, ../contract/src/features/local-control/langy.local-control-http.ts:34
type Body = Record<string, unknown>;
// Response: langyControlCancelResultSchema, ../contract/src/langy-rest.schemas.ts:112
interface Response {
  id: string;
  cancelled: true;
}
```

### `langyLocalRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/langy-local.rest.ts:56` |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `GET /api/langy/local/workspace` · `langyLocalWorkspace`

The code access card's own status document, as the command line reads it.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:64`.

Answers at `/api/langy/local/workspace`.

```typescript
// Query: langyLocalWorkspaceQuerySchema, ../contract/src/langy-rest.schemas.ts:90
interface Query {
  conversationId?: string;
}
type Response = z.infer<typeof workspaceStatusSchema>; // ../contract/src/features/local-control/langy.local-control-http.ts:55
```

#### `POST /api/langy/local/requests` · `langyLocalCreateRequest`

The recorded request and the command that approves it.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:81`.

Answers at `/api/langy/local/requests`.

```typescript
// Body: langyLocalCreateRequestBodySchema, ../contract/src/langy-rest.schemas.ts:95
interface Body {
  conversationId: string;
}
type Response = z.infer<typeof createControlRequestResponseSchema>; // ../contract/src/features/local-control/langy.local-control-http.ts:69
```

#### `POST /api/langy/local/calls` · `langyLocalStartCall`

The started call's own id.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:97`.

Answers at `/api/langy/local/calls`.

```typescript
// Rawbody: "text" (inline, src/transport/langy-local.rest.ts:102)
// Response: startCallResponseSchema, ../contract/src/features/local-control/langy.local-control-http.ts:79
interface Response {
  callId: string;
}
```

#### `GET /api/langy/local/calls/:callId` · `langyLocalReadCall`

The call's answer, or not found while it is still running.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:114`.

Answers at `/api/langy/local/calls/:callId`.

```typescript
// Params: langyLocalCallIdParamsSchema, ../contract/src/langy-rest.schemas.ts:84
interface Params {
  callId: string;
}
type Response = z.infer<typeof pollCallResponseSchema>; // ../contract/src/features/local-control/langy.local-control-http.ts:94
```

#### `POST /api/langy/local/calls/:callId/cancel` · `langyLocalCancelCall`

The cancelled call's own id.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:128`.

Answers at `/api/langy/local/calls/:callId/cancel`.

```typescript
type Params = z.infer<typeof langyLocalCallIdParamsSchema>; // ../contract/src/langy-rest.schemas.ts:84
type Body = z.infer<typeof controlActionBodySchema>; // ../contract/src/features/local-control/langy.local-control-http.ts:34
// Response: cancelCallResponseSchema, ../contract/src/features/local-control/langy.local-control-http.ts:84
interface Response {
  callId: string;
  cancelled: true;
}
```

#### `POST /api/langy/waits` · `langyLocalStartWait`

The started wait's own id.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:144`.

Answers at `/api/langy/waits`.

```typescript
type Body = z.infer<typeof langyLocalStartWaitRequestSchema>; // ../contract/src/langy-rest.schemas.ts:101
// Response: startWaitResponseSchema, ../contract/src/features/local-control/langy.local-control-http.ts:128
interface Response {
  waitId: string;
}
```

#### `GET /api/langy/waits/:waitId` · `langyLocalReadWait`

The answered question, or not found while it is still waiting.

Authenticated: the service bridges the session key to its owner and proves the conversation is theirs. Declared at `src/transport/langy-local.rest.ts:154`.

Answers at `/api/langy/waits/:waitId`.

```typescript
// Params: langyLocalWaitIdParamsSchema, ../contract/src/langy-rest.schemas.ts:87
interface Params {
  waitId: string;
}
// Response: pollWaitResponseSchema, ../contract/src/features/local-control/langy.local-control-http.ts:142
interface Response {
  waitId: string;
  state: "pending" | "answered" | "expired" | "cancelled";
  answers?: {
    question: string;
    selected: string[];
    other?: string;
  }[];
}
```

### `langyTurnsRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/langy-turns.rest.ts:147` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/langy/conversations` · `startLangyConversationTurn`

Start a Langy conversation with one turn. The turn surface answers 202 with the accepted turn, 200 with the settled reply under Prefer: wait, and a plain 404 when the rollout is dark for the project.

Permission `langy:create`. Declared at `src/transport/langy-turns.rest.ts:153`.

Answers at `/api/langy/conversations`, `/api/v1/langy/conversations`.

```typescript
// Body: startTurnBodySchema, src/transport/langy-turns.rest.ts:52
interface Body {
  messages: {
    role: "user" | "assistant" | "system";
    parts?: Record<string, BodySchema0>[];
    content?: string;
  }[];
  idempotencyKey: string;
  modelOverride?: string;
  adoptConversationId?: boolean;
}
type BodySchema0 = string | number | boolean | null | BodySchema0[] | Record<string, BodySchema0>;
// Response: inline, src/transport/langy-turns.rest.ts:156
type Response = unknown;
```

#### `POST /api/langy/conversations/:conversationId/messages` · `continueLangyConversationTurn`

Continue one Langy conversation with a turn. The turn surface answers 202 with the accepted turn, 200 with the settled reply under Prefer: wait, and a plain 404 when the rollout is dark for the project.

Permission `langy:create`. Declared at `src/transport/langy-turns.rest.ts:170`.

Answers at `/api/langy/conversations/:conversationId/messages`, `/api/v1/langy/conversations/:conversationId/messages`.

```typescript
// Params: langyRestConversationParamsSchema, ../contract/src/langy-rest.schemas.ts:171
interface Params {
  conversationId: string;
}
// Body: langyRestTurnBodySchema, ../contract/src/langy-rest.schemas.ts:175
interface Body {
  messages: {
    role: "user" | "assistant" | "system";
    parts?: Record<string, BodySchema0>[];
    content?: string;
  }[];
  idempotencyKey: string;
  modelOverride?: string;
  adoptConversationId?: boolean;
}
type BodySchema0 = string | number | boolean | null | BodySchema0[] | Record<string, BodySchema0>;
// Response: inline, src/transport/langy-turns.rest.ts:174
type Response = unknown;
```

### `langyUiActionsRest`

|             |                                             |
| ----------- | ------------------------------------------- |
| Declared at | `src/transport/langy-ui-actions.rest.ts:78` |
| Base URL    | none: each route's path is its address      |
| Addressing  | literal                                     |
| Credential  | project                                     |

#### `POST /api/langy/ui/actions` · `langyUiActionsDispatch`

The dispatch answers the action service's own outcome, and a plain 404 when the rollout is dark for the project.

Deferred scope: the dispatched action's own kind names the permission it requires, so the ceiling is the key's ceiling on THAT permission - only the handler, having read the body, knows which one. Declared at `src/transport/langy-ui-actions.rest.ts:84`.

Answers at `/api/langy/ui/actions`.

```typescript
// Rawbody: "text" (inline, src/transport/langy-ui-actions.rest.ts:86)
// Response: inline, src/transport/langy-ui-actions.rest.ts:88
type Response = unknown;
```

#### `GET /api/langy/ui/actions` · `langyUiActionsList`

The catalogue publishes each action's own draft-07 payload schema, which the CLI reads as it stands.

Deferred scope: the dispatched action's own kind names the permission it requires, so the ceiling is the key's ceiling on THAT permission - only the handler, having read the body, knows which one. Declared at `src/transport/langy-ui-actions.rest.ts:98`.

Answers at `/api/langy/ui/actions`.

```typescript
// Response: inline, src/transport/langy-ui-actions.rest.ts:100
type Response = unknown;
```

## tRPC transport

### `langy`

Contract `../contract/src/langy.trpc.ts:58`, router `src/transport/langy.trpc.ts:33`.

| Procedure                        | Kind         | Gate                      | Input                                     | Output                                |
| -------------------------------- | ------------ | ------------------------- | ----------------------------------------- | ------------------------------------- |
| `langy.list`                     | query        | Permission `langy:view`   | `langyListInputSchema`                    | `langyConversationListPageDtoSchema`  |
| `langy.conversationEventsAfter`  | query        | Permission `langy:view`   | `langyEventsAfterInputSchema`             | `langyConversationEventPageDtoSchema` |
| `langy.detail`                   | query        | Permission `langy:view`   | `langyPanelConversationInputSchema`       | inline                                |
| `langy.messages`                 | query        | Permission `langy:view`   | `langyPanelConversationInputSchema`       | `langyConversationMessagesDtoSchema`  |
| `langy.deleteConversation`       | mutation     | Permission `langy:delete` | `langyPanelConversationInputSchema`       | `langyConversationDeletedSchema`      |
| `langy.renameConversation`       | mutation     | Permission `langy:update` | `langyRenameInputSchema`                  | `langyConversationDetailSchema`       |
| `langy.forkConversation`         | mutation     | Permission `langy:create` | `langyForkInputSchema`                    | `langyConversationDetailSchema`       |
| `langy.createConversation`       | mutation     | Permission `langy:create` | `langyPanelCreateConversationInputSchema` | `langyTurnStartedSchema`              |
| `langy.continueConversation`     | mutation     | Permission `langy:create` | `langyContinueConversationInputSchema`    | `langyTurnStartedSchema`              |
| `langy.stopTurn`                 | mutation     | Permission `langy:create` | `langyStopTurnPanelInputSchema`           | `langyTurnStoppedSchema`              |
| `langy.claimUiAction`            | mutation     | Permission `langy:view`   | `langyClaimUiActionInputSchema`           | `langyUiActionClaimedSchema`          |
| `langy.completeUiAction`         | mutation     | Permission `langy:view`   | `langyCompleteUiActionInputSchema`        | `langyUiActionCompletedSchema`        |
| `langy.answerLocalPermission`    | mutation     | Permission `langy:create` | `langyAnswerLocalPermissionInputSchema`   | `langyLocalAnsweredSchema`            |
| `langy.answerQuestion`           | mutation     | Permission `langy:create` | `langyAnswerQuestionInputSchema`          | `langyLocalAnsweredSchema`            |
| `langy.setLocalPolicy`           | mutation     | Permission `langy:create` | `langySetLocalPolicyInputSchema`          | `langyLocalPolicySchema`              |
| `langy.disconnectLocalWorkspace` | mutation     | Permission `langy:create` | `langyPanelConversationInputSchema`       | `langyLocalDisconnectedSchema`        |
| `langy.setCodeAccessPreference`  | mutation     | Permission `langy:update` | `langySetCodeAccessPreferenceInputSchema` | `langyCodeAccessPreferenceSchema`     |
| `langy.getCodeAccessPreference`  | query        | Permission `langy:view`   | `langyProjectInputSchema`                 | `langyCodeAccessPreferenceSchema`     |
| `langy.localRecord`              | query        | Permission `langy:view`   | `langyPanelConversationInputSchema`       | `langyLocalRecordSchema`              |
| `langy.getLocalWorkspace`        | query        | Permission `langy:view`   | `langyPanelConversationInputSchema`       | `langyLocalWorkspaceStatusSchema`     |
| `langy.renewLocalControlRequest` | mutation     | Permission `langy:create` | `langyPanelConversationInputSchema`       | `langyControlRequestRenewedSchema`    |
| `langy.warmWorker`               | mutation     | Permission `langy:create` | `langyWarmWorkerInputSchema`              | `langyWarmedWorkerSchema`             |
| `langy.modelsAllowed`            | query        | Permission `langy:view`   | `langyProjectInputSchema`                 | `langyModelsAllowedSchema`            |
| `langy.recordFeedback`           | mutation     | Permission `langy:create` | `langyRecordFeedbackInputSchema`          | –                                     |
| `langy.feedbackPromptShown`      | mutation     | Permission `langy:create` | `langyFeedbackPromptShownInputSchema`     | –                                     |
| `langy.onConversationUpdate`     | subscription | Permission `langy:view`   | `langyProjectInputSchema`                 | `langyConversationUpdateFrameSchema`  |
| `langy.onTurnStream`             | subscription | Permission `langy:view`   | `langyTurnStreamInputSchema`              | `langyStreamEntrySchema`              |

```typescript
// langy.list
// Input: langyListInputSchema, ../contract/src/langy-trpc.schemas.ts:54
interface Input {
  projectId: string;
  limit?: number;
  cursor?: {
    lastActivityAtMs: number | null;
    id: string;
  };
  query?: string;
}
type Output = z.infer<typeof langyConversationListPageDtoSchema>; // ../contract/src/langy.dtos.ts:100

// langy.conversationEventsAfter
// Input: langyEventsAfterInputSchema, ../contract/src/langy-trpc.schemas.ts:61
interface Input {
  projectId: string;
  conversationId: string;
  after: {
    acceptedAt: number;
    eventId: string;
  };
}
type Output = z.infer<typeof langyConversationEventPageDtoSchema>; // ../contract/src/langy.dtos.ts:107

// langy.detail
// Input: langyPanelConversationInputSchema, ../contract/src/langy-trpc.schemas.ts:49
interface Input {
  projectId: string;
  conversationId: string;
}
// Output: inline, ../contract/src/langy.trpc.ts:70
type Output = {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  origin: "interactive" | "run";
  messageCount: number;
  lastActivityAtMs: number;
  status: "active" | "running" | "idle" | "failed" | "archived";
} | null;

// langy.messages
type Input = z.infer<typeof langyPanelConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:49
type Output = z.infer<typeof langyConversationMessagesDtoSchema>; // ../contract/src/langy.dtos.ts:118

// langy.deleteConversation
type Input = z.infer<typeof langyPanelConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:49
// Output: langyConversationDeletedSchema, ../contract/src/langy.dtos.ts:155
interface Output {
  success: boolean;
}

// langy.renameConversation
// Input: langyRenameInputSchema, ../contract/src/langy-trpc.schemas.ts:67
interface Input {
  projectId: string;
  conversationId: string;
  title: string;
}
// Output: langyConversationDetailSchema, ../contract/src/langy.dtos.ts:43
interface Output {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  origin: "interactive" | "run";
  messageCount: number;
  lastActivityAtMs: number;
  status: "active" | "running" | "idle" | "failed" | "archived";
}

// langy.forkConversation
// Input: langyForkInputSchema, ../contract/src/langy-trpc.schemas.ts:73
interface Input {
  projectId: string;
  conversationId: string;
}
type Output = z.infer<typeof langyConversationDetailSchema>; // ../contract/src/langy.dtos.ts:43

// langy.createConversation
type Input = z.infer<typeof langyPanelCreateConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:93
// Output: langyTurnStartedSchema, ../contract/src/langy.dtos.ts:158
interface Output {
  conversationId: string;
  turnId: string;
}

// langy.continueConversation
type Input = z.infer<typeof langyContinueConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:98
type Output = z.infer<typeof langyTurnStartedSchema>; // ../contract/src/langy.dtos.ts:158

// langy.stopTurn
// Input: langyStopTurnPanelInputSchema, ../contract/src/langy-trpc.schemas.ts:103
interface Input {
  projectId: string;
  conversationId: string;
  turnId: string;
}
// Output: langyTurnStoppedSchema, ../contract/src/langy.dtos.ts:164
interface Output {
  stopped: boolean;
}

// langy.claimUiAction
// Input: langyClaimUiActionInputSchema, ../contract/src/langy-trpc.schemas.ts:109
interface Input {
  projectId: string;
  conversationId: string;
  actionId: string;
}
// Output: langyUiActionClaimedSchema, ../contract/src/langy.dtos.ts:167
interface Output {
  isClaimed: boolean;
}

// langy.completeUiAction
// Input: langyCompleteUiActionInputSchema, ../contract/src/langy-trpc.schemas.ts:115
interface Input {
  projectId: string;
  conversationId: string;
  actionId: string;
  ok: boolean;
  result?: unknown;
  errorCode?: string;
}
// Output: langyUiActionCompletedSchema, ../contract/src/langy.dtos.ts:170
interface Output {
  isAccepted: boolean;
}

// langy.answerLocalPermission
// Input: langyAnswerLocalPermissionInputSchema, ../contract/src/langy-trpc.schemas.ts:124
interface Input {
  projectId: string;
  conversationId: string;
  waitId: string;
  decision: "allow_once" | "allow_pattern" | "deny";
}
// Output: langyLocalAnsweredSchema, ../contract/src/langy-trpc.schemas.ts:187
interface Output {
  answered: true;
}

// langy.answerQuestion
// Input: langyAnswerQuestionInputSchema, ../contract/src/langy-trpc.schemas.ts:131
interface Input {
  projectId: string;
  conversationId: string;
  waitId: string;
  answers: {
    question: string;
    selected: string[];
    other?: string;
  }[];
}
type Output = z.infer<typeof langyLocalAnsweredSchema>; // ../contract/src/langy-trpc.schemas.ts:187

// langy.setLocalPolicy
// Input: langySetLocalPolicyInputSchema, ../contract/src/langy-trpc.schemas.ts:147
interface Input {
  projectId: string;
  conversationId: string;
  skipPermissions: boolean;
}
// Output: langyLocalPolicySchema, ../contract/src/langy-trpc.schemas.ts:188
interface Output {
  skipPermissions: boolean;
}

// langy.disconnectLocalWorkspace
type Input = z.infer<typeof langyPanelConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:49
// Output: langyLocalDisconnectedSchema, ../contract/src/langy-trpc.schemas.ts:189
interface Output {
  disconnected: boolean;
}

// langy.setCodeAccessPreference
// Input: langySetCodeAccessPreferenceInputSchema, ../contract/src/langy-trpc.schemas.ts:153
interface Input {
  projectId: string;
  preference: "github" | null;
}
// Output: langyCodeAccessPreferenceSchema, ../contract/src/features/local-control/langy.local-control-http.ts:178
interface Output {
  preference: "github" | null;
}

// langy.getCodeAccessPreference
// Input: langyProjectInputSchema, ../contract/src/langy-trpc.schemas.ts:47
interface Input {
  projectId: string;
}
type Output = z.infer<typeof langyCodeAccessPreferenceSchema>; // ../contract/src/features/local-control/langy.local-control-http.ts:178

// langy.localRecord
type Input = z.infer<typeof langyPanelConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:49
// Output: langyLocalRecordSchema, ../contract/src/features/local-control/langy.local-control-http.ts:150
interface Output {
  waits: {
    turnId: string;
    toolCallId: string;
    [key: string]: unknown;
  }[];
  workspaceConnected: boolean;
}

// langy.getLocalWorkspace
type Input = z.infer<typeof langyPanelConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:49
// Output: langyLocalWorkspaceStatusSchema, ../contract/src/features/local-control/langy.local-control-http.ts:167
interface Output {
  connected: boolean;
  workspace: Record<string, unknown> | null;
  skipAllowed: boolean;
  skipPermissions: boolean;
  pendingRequest: Record<string, unknown> | null;
  requestState: "open" | "approved" | "expired" | "declined" | "ended" | "none";
  codeAccessPreference: "github" | null;
}

// langy.renewLocalControlRequest
type Input = z.infer<typeof langyPanelConversationInputSchema>; // ../contract/src/langy-trpc.schemas.ts:49
// Output: langyControlRequestRenewedSchema, ../contract/src/langy-trpc.schemas.ts:190
interface Output {
  expiresAt: string;
}

// langy.warmWorker
// Input: langyWarmWorkerInputSchema, ../contract/src/langy-trpc.schemas.ts:158
interface Input {
  projectId: string;
  conversationId?: string;
  modelOverride?: string;
}
// Output: langyWarmedWorkerSchema, ../contract/src/langy.dtos.ts:173
interface Output {
  conversationId: string | null;
  warmed: boolean;
}

// langy.modelsAllowed
type Input = z.infer<typeof langyProjectInputSchema>; // ../contract/src/langy-trpc.schemas.ts:47
// Output: langyModelsAllowedSchema, ../contract/src/langy.dtos.ts:179
interface Output {
  modelsAllowed: string[] | null;
}

// langy.recordFeedback
// Input: langyRecordFeedbackInputSchema, ../contract/src/langy-trpc.schemas.ts:164
interface Input {
  projectId: string;
  conversationId?: string;
  messageId?: string;
  traceId?: string;
  rating: "up" | "down";
  sentiment?: "frustrated" | "delighted" | "neutral";
  comment?: string;
  shareConversationConsent?: boolean;
}

// langy.feedbackPromptShown
// Input: langyFeedbackPromptShownInputSchema, ../contract/src/langy-trpc.schemas.ts:176
interface Input {
  projectId: string;
  conversationId: string;
}

// langy.onConversationUpdate
type Input = z.infer<typeof langyProjectInputSchema>; // ../contract/src/langy-trpc.schemas.ts:47
// Output: langyConversationUpdateFrameSchema, ../contract/src/langy.dtos.ts:184
interface Output {
  event: unknown;
  timestamp?: number;
}

// langy.onTurnStream
// Input: langyTurnStreamInputSchema, ../contract/src/langy-trpc.schemas.ts:181
interface Input {
  projectId: string;
  conversationId: string;
  turnId: string;
}
type Output = z.infer<typeof langyStreamEntrySchema>; // ../contract/src/langy.stream-entry.ts:12
```

### `langyEgress`

Contract `../contract/src/langy.trpc.ts:192`, router `src/transport/langy.trpc.ts:228`.

| Procedure         | Kind     | Gate                      | Input                       | Output                   |
| ----------------- | -------- | ------------------------- | --------------------------- | ------------------------ |
| `langyEgress.get` | query    | Permission `langy:view`   | `langyEgressGetInputSchema` | `langyEgressStateSchema` |
| `langyEgress.set` | mutation | Permission `langy:manage` | `langyEgressSetInputSchema` | `langyEgressStateSchema` |

```typescript
// langyEgress.get
// Input: langyEgressGetInputSchema, ../contract/src/langy-trpc.schemas.ts:37
interface Input {
  projectId: string;
}
// Output: langyEgressStateSchema, ../contract/src/langy-trpc.schemas.ts:32
interface Output {
  allowlist: string[];
  enforcing: boolean;
}

// langyEgress.set
// Input: langyEgressSetInputSchema, ../contract/src/langy-trpc.schemas.ts:40
interface Input {
  projectId: string;
  allowlist: string[];
}
type Output = z.infer<typeof langyEgressStateSchema>; // ../contract/src/langy-trpc.schemas.ts:32
```

### `setupSkills`

Contract `../contract/src/langy.trpc.ts:208`, router `src/transport/setup-skills.trpc.ts:10`.

| Procedure               | Kind  | Gate                      | Input  | Output |
| ----------------------- | ----- | ------------------------- | ------ | ------ |
| `setupSkills.getPrompt` | query | Permission `project:view` | inline | inline |

```typescript
// setupSkills.getPrompt
// Input: inline, ../contract/src/langy.trpc.ts:210
interface Input {
  projectId: string;
  skill: string;
}
// Output: inline, ../contract/src/langy.trpc.ts:211
interface Output {
  body: string;
}
```

## Sockets

| Protocol  | Paths                           | Prefixes | Declared at                                  |
| --------- | ------------------------------- | -------- | -------------------------------------------- |
| websocket | `/api/v1/langy/control/connect` | –        | `src/transport/langy-local-control.ws.ts:27` |

## Workers

### Pipeline `langy_conversation_processing` (aggregate `langy_conversation`)

Declared at `src/eventing/langy-conversation.pipeline.ts:117`. Events: `LangyConversationStartedEventSchema`, `LangyConversationForkedEventSchema`, `LangyMessageRecordedEventSchema`, `LangyMessageImportedEventSchema`, `LangyAgentTurnAcceptedEventSchema`, `LangyToolCallInitiatedEventSchema`, `LangyToolCallSucceededEventSchema`, `LangyToolCallFailedEventSchema`, `LangyPlanUpdatedEventSchema`, `LangyAgentResponseFailedEventSchema`, `LangyAgentRespondedEventSchema`, `LangyConversationArchivedEventSchema`, `LangyConversationMetadataUpdatedEventSchema`, `LangyConversationHandoffPendingEventSchema`, `LangyConversationHandoffConsumedEventSchema`, `LangyConversationTitleGeneratedEventSchema`, `LangyLocalControlRequestedEventSchema`, `LangyLocalWorkspaceConnectedEventSchema`, `LangyLocalWorkspaceDisconnectedEventSchema`, `LangyLocalPolicyChangedEventSchema`, `LangyUserWaitStartedEventSchema`, `LangyUserWaitEndedEventSchema`.

### Pipeline `langy_guided_onboarding` (aggregate `langy_guided_onboarding`)

Declared at `src/eventing/langy-guided-onboarding.pipeline.ts:31`. Events: `guidedOnboardingTurnFailedEventSchema`.

| Kind    | Name                               | Handles | Declared at                                           |
| ------- | ---------------------------------- | ------- | ----------------------------------------------------- |
| command | `recordGuidedOnboardingTurnFailed` | –       | `src/eventing/langy-guided-onboarding.pipeline.ts:36` |

### Pipeline `langy_maintenance` (aggregate `global`)

Declared at `src/eventing/langy-maintenance.pipeline.ts:30`.

| Kind            | Name                         | Handles                                                      | Declared at                                     |
| --------------- | ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| peer subscriber | `provisionProjectVirtualKey` | `lw.project.created` from [project](../../project/README.md) | `src/eventing/langy-maintenance.pipeline.ts:37` |

## Configuration

| Kind   | Leaf                 | Environment variable        | Declared at                          |
| ------ | -------------------- | --------------------------- | ------------------------------------ |
| secret | `–`                  | `LANGY_INTERNAL_SECRET`     | `src/app/langy.app.ts:286`           |
| config | `agentUrl`           | `LANGY_AGENT_URL`           | `../contract/src/langy.config.ts:18` |
| config | `workerCallbackUrl`  | `LANGY_WORKER_CALLBACK_URL` | `../contract/src/langy.config.ts:19` |
| config | `workerGatewayUrl`   | `LANGY_WORKER_GATEWAY_URL`  | `../contract/src/langy.config.ts:20` |
| config | `mirrorProjectId`    | `LANGY_MIRROR_PROJECT_ID`   | `../contract/src/langy.config.ts:21` |
| config | `gatewayInternalUrl` | `LW_GATEWAY_INTERNAL_URL`   | `../contract/src/langy.config.ts:22` |
| config | `gatewayPublicUrl`   | `LW_GATEWAY_PUBLIC_URL`     | `../contract/src/langy.config.ts:23` |
| config | `gatewayLegacyUrl`   | `LW_GATEWAY_BASE_URL`       | `../contract/src/langy.config.ts:24` |
| config | `publicBaseUrl`      | `BASE_HOST`                 | `../contract/src/langy.config.ts:25` |

<!-- readme:generated:end -->
