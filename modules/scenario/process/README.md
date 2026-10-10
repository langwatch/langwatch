# @langwatch/scenario-process

The server half of [scenario](../README.md). Scenarios and simulations: authored scenarios, their runs and events, exports, and the voice sessions a simulation uses.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("scenario").withRepositories(scenarioRepositories).withChannels(scenarioChannels).withApi(ScenarioModule).withTransports(…, …, …, scenarioAgentTestRest, scenarioEventsRest, scenarioGenerateRest, scenarioRunExportRest, scenarioVoiceRest, scenarioTrpcTransport).provideMiddlewareContext(…).withEventing(scenarioLifecycleEventing).withEventing(simulationProcessingEventing).withMigrations(…)`, `src/scenario.module.ts:31`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ScenarioApi`)

The scenario application: what every scenario door calls, and what peer features such as Suite reach it by.

Peers call these through the token, declared at `../contract/src/scenario.api.ts:249`; nothing else in this package is public.

#### `generateScenario`

```typescript
generateScenario(input: ScenarioGenerateRequest): Promise<ScenarioGenerateResponse>;
```

#### `reportScenarioEvent`

```typescript
reportScenarioEvent(input: ScenarioEventReportInput): Promise<ScenarioEventReportResult>;
```

#### `offerScenarioBrowserTab`

```typescript
offerScenarioBrowserTab(input: ScenarioEventBrowserTabOfferInput): Promise<ScenarioEventBrowserTabOfferResult>;
```

#### `archiveScenarioEvents`

```typescript
archiveScenarioEvents(input: ScenarioEventArchiveInput): Promise<ScenarioEventArchiveResult>;
```

#### `downloadScenarioRunExport`

```typescript
downloadScenarioRunExport(input: ScenarioRunExportDownloadInput): Promise<ScenarioRunExportDownload>;
```

#### `mintVoiceSession`

```typescript
mintVoiceSession(input: VoiceSessionMintRequest): Promise<VoiceSessionMintResult>;
```

#### `finishVoiceSession`

```typescript
finishVoiceSession(input: VoiceSessionFinishRequest): Promise<VoiceSessionFinishResult>;
```

#### `streamVoiceSessionAudio`

```typescript
streamVoiceSessionAudio(input: VoiceSessionAudioRequest): Promise<VoiceRecordingStream>;
```

#### `streamVoiceRunAudio`

```typescript
streamVoiceRunAudio(input: VoiceRunAudioRequest): Promise<VoiceRunRecordingStream>;
```

#### `testAgentTurn`

```typescript
testAgentTurn(input: TestAgentTurnInput): Promise<AgentTestTurnResult>;
```

#### `testAgentRun`

```typescript
testAgentRun(input: TestAgentRunInput): Promise<AgentTestRunResult>;
```

#### `testHttpAgent`

```typescript
testHttpAgent(input: HttpAgentTestInput & { actorId: string }): Promise<HttpProxyResult>;
```

#### `list`

```typescript
list(input: { projectId: string }): Promise<Scenario[]>;
```

#### `listTestSuites`

```typescript
listTestSuites(input: { projectId: string; includeArchived?: boolean; }): Promise<ScenarioTestSuite[]>;
```

#### `getReferenceStates`

```typescript
getReferenceStates(input: { ids: string[]; projectId: string; }): Promise<ScenarioReferenceState[]>;
```

#### `getRunConfigs`

```typescript
getRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]>;
```

#### `getModelChoices`

```typescript
getModelChoices(input: { ids: string[]; projectId: string; }): Promise<{ id: string; simulatorModel: string | null; judgeModel: string | null }[]>;
```

#### `resolveRunParameters`

```typescript
resolveRunParameters(input: ResolveScenarioRunParametersInput): Promise<ResolvedScenarioRunParameters>;
```

#### `resolveRunParametersForScenarios`

```typescript
resolveRunParametersForScenarios(input: { scenarios: ScenarioRunConfig[]; values?: RunParameterValues; }): Promise<ResolvedScenarioRunParametersForScenario[]>;
```

#### `getNamesByIds`

```typescript
getNamesByIds(input: { ids: string[]; projectId: string; }): Promise<{ id: string; name: string }[]>;
```

#### `findTestSuite`

```typescript
findTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null>;
```

#### `createTestSuite`

```typescript
createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite>;
```

#### `updateTestSuite`

```typescript
updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite>;
```

#### `getTestSuiteRunDefinition`

```typescript
getTestSuiteRunDefinition(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuiteRunDefinition>;
```

#### `archiveTestSuite`

```typescript
archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite>;
```

#### `renameTestSuite`

```typescript
renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite>;
```

#### `getInternalSuiteSummaries`

```typescript
getInternalSuiteSummaries(input: SimulationProjectDateRangeInput): Promise<SimulationExternalSetSummary[]>;
```

#### `count`

How many scenarios the project holds.

```typescript
count(input: { projectId: string }): Promise<number>;
```

#### `getById`

One live scenario. Throws `ScenarioNotFoundError` when the project holds none.

```typescript
getById(input: ScenarioIdInput): Promise<Scenario>;
```

#### `readByIdIncludingArchived`

The same read, archived rows included; a miss is `found: false`, not a refusal.

```typescript
readByIdIncludingArchived(input: ScenarioIdInput): Promise<ScenarioLookup>;
```

#### `create`

```typescript
create(input: Omit<ScenarioCreateInput, "lastUpdatedById">, by: ScenarioCaller): Promise<Scenario>;
```

#### `update`

```typescript
update(input: Omit<ScenarioUpdateInput, "lastUpdatedById">, by: ScenarioCaller): Promise<Scenario>;
```

#### `archive`

```typescript
archive(input: ScenarioIdInput): Promise<Scenario>;
```

#### `batchArchive`

```typescript
batchArchive(input: { projectId: string; ids: string[]; }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }>;
```

#### `moveToTestSuite`

```typescript
moveToTestSuite(input: ScenarioMoveInput): Promise<Scenario>;
```

#### `duplicate`

```typescript
duplicate(input: Omit<ScenarioDuplicateInput, "lastUpdatedById">, by: ScenarioCaller): Promise<Scenario>;
```

#### `listVersions`

```typescript
listVersions(input: ScenarioVersionListInput): Promise<{ versions: ScenarioVersionSummary[]; nextCursor: number | null }>;
```

#### `getVersion`

```typescript
getVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail>;
```

#### `restoreVersion`

```typescript
restoreVersion(input: Omit<ScenarioVersionRestoreInput, "actor">, by: ScenarioCaller): Promise<Scenario>;
```

#### `getUserProfiles`

The people a version history names, for the author column.

```typescript
getUserProfiles(input: UserProfilesInput): Promise<UserFullProfile[]>;
```

#### `launchRun`

Resolves, validates and queues one run: the tRPC `run` and the scenario canary share it.

```typescript
launchRun(input: ScenarioLaunchRunInput): Promise<ScenarioRunScheduled>;
```

#### `prefetchExecution`

```typescript
prefetchExecution(input: ScenarioExecutionPrefetchInput): Promise<ScenarioExecutionPrefetchResult>;
```

#### `queueSimulationRun`

```typescript
queueSimulationRun(input: QueueSimulationRunInput): Promise<void>;
```

#### `computeRunMetrics`

Queues a settled simulation trace's run metrics onto simulation_processing.

```typescript
computeRunMetrics(input: ComputeRunMetricsCommandData): Promise<void>;
```

#### `cancelJob`

```typescript
cancelJob(input: CancelScenarioRunInput): Promise<{ cancelled: boolean }>;
```

#### `cancelBatchRun`

```typescript
cancelBatchRun(input: CancelScenarioBatchInput): Promise<{ cancelledCount: number; skippedCount: number }>;
```

#### `readSuiteRunData`

```typescript
readSuiteRunData(input: { projectId: string; scenarioSetId?: string; limit: number; cursor?: string; startDate?: number; endDate?: number; sinceTimestamp?: number; }): Promise<SimulationAllSuitesRunData>;
```

#### `getScenarioSetsData`

```typescript
getScenarioSetsData(input: SimulationProjectDateRangeInput): Promise<SimulationSetData[]>;
```

#### `getLastResultSummaries`

```typescript
getLastResultSummaries(input: SimulationLastResultSummariesInput): Promise<SimulationLastResultSummary[]>;
```

#### `getLastUpdatedAt`

```typescript
getLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number>;
```

#### `getRunDataForScenarioSet`

```typescript
getRunDataForScenarioSet(input: SimulationScenarioSetRunsInput): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }>;
```

#### `findScenarioRunData`

```typescript
findScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null>;
```

#### `getRunState`

One run by its id. Throws `not_found` when the project holds none.

```typescript
getRunState(input: SimulationScenarioRunInput): Promise<SimulationRunData>;
```

#### `listSimulationRuns`

The public API's run listing, by batch, by set, or across every suite.

```typescript
listSimulationRuns(input: SimulationRunListInput): Promise<SimulationRunListResponse>;
```

#### `getSimulationRun`

One run for the public API. Throws `SimulationRunNotFoundError` when absent.

```typescript
getSimulationRun(input: SimulationRunLookupInput): Promise<SimulationRunRestResponse>;
```

#### `getBatchSummary`

One batch's summary for the public API. Throws `BatchRunNotFoundError` when absent.

```typescript
getBatchSummary(input: { projectId: string; batchRunId: string; }): Promise<SimulationBatchSummaryRest>;
```

#### `getBatchRunCountForScenarioSet`

```typescript
getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number>;
```

#### `getBatchHistoryForScenarioSet`

```typescript
getBatchHistoryForScenarioSet(input: SimulationBatchHistoryInput): Promise<SimulationBatchHistory>;
```

#### `getRunDataForBatchRun`

```typescript
getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData>;
```

#### `getExternalSetSummaries`

```typescript
getExternalSetSummaries(input: SimulationProjectDateRangeInput): Promise<SimulationExternalSetSummary[]>;
```

#### `getRunDataForAllSuites`

```typescript
getRunDataForAllSuites(input: SimulationAllSuitesInput): Promise<SimulationAllSuitesRunData>;
```

#### `simulationUpdates`

Frames published for this project's live simulation stream.

```typescript
simulationUpdates(input: { projectId: string; signal?: AbortSignal; }): AsyncIterable<SimulationStreamFrame>;
```

#### `startTabPresence`

Registers one open browser tab, and hands back how to retire it.

```typescript
startTabPresence(registration: ScenarioTabRegistration): Promise<ScenarioTabPresence>;
```

#### `acceptVoiceMediaUpgrade`

Hands one Twilio media upgrade to the scenario child that registered its nonce.

```typescript
acceptVoiceMediaUpgrade(upgrade: VoiceMediaUpgrade): void;
```

#### `watchSimulationUpdates`

One tab's live stream: its parked navigate first, then the project's frames.

```typescript
watchSimulationUpdates(input: SimulationUpdateWatchInput): AsyncIterable<SimulationStreamFrame>;
```

#### `getResultsOverview`

```typescript
getResultsOverview(input: { filter: ResultsFilter; groupBy: ResultsGroupBy; }): Promise<ResultsOverview>;
```

#### `getResultAtoms`

```typescript
getResultAtoms(input: { filter: ResultsFilter; limit: number; cursor?: string; }): Promise<{ atoms: ResultAtom[]; nextCursor?: string; hasMore: boolean }>;
```

#### `getCodeScenarios`

```typescript
getCodeScenarios(input: { projectId: string; startDate: number; endDate?: number; }): Promise<CodeScenario[]>;
```

#### `getRunTargets`

```typescript
getRunTargets(input: { projectId: string; startDate: number; endDate?: number; }): Promise<RunTarget[]>;
```

#### `getRunConfigurations`

```typescript
getRunConfigurations(input: { projectId: string; startDate?: number; endDate?: number; limit?: number; }): Promise<RunConfigurationEntryResponse[]>;
```

#### `platformUrl`

The platform's own address for one scenario or run, in the interface the project reads.

```typescript
platformUrl(input: { projectId: string; projectSlug: string; resource: { scenarioId: string } | { scenarioRunId: string }; }): Promise<string>;
```

#### `findBatchSummary`

The pass/fail counts of one batch run, or null when the project holds none.

```typescript
findBatchSummary(input: { projectId: string; batchRunId: string; }): Promise<SimulationBatchSummary | null>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<ScenarioUsageCount>;
```

## REST transport

### `scenarioAgentTestRest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/scenario-agent-test.rest.ts:25` |
| Base URL    | none: each route's path is its address         |
| Addressing  | literal                                        |
| Credential  | project                                        |

#### `POST /api/v1/agents/:id/test` · `testAgent`

Schedule a scripted test run and return its run identifiers

Permission `scenarios:create`. Declared at `src/transport/scenario-agent-test.rest.ts:30`.

Answers at `/api/v1/agents/:id/test`.

```typescript
// Params: agentTestRestParamsSchema, ../contract/src/scenario-rest.schemas.ts:205
interface Params {
  id: string;
}
// Body: testAgentBodySchema, ../contract/src/scenario-rest.schemas.ts:210
type Body = Record<string, unknown>;
// Response: agentTestRunResponseSchema, ../contract/src/scenario-rest.schemas.ts:212
interface Response {
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
}
```

### `scenarioEventsRest`

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| Declared at | `src/transport/scenario-event.rest.ts:21`              |
| Base URL    | `/api/scenario-events`, twin `/api/v1/scenario-events` |
| Addressing  | dated                                                  |
| Credential  | project                                                |
| Versions    | `2026-08-07`                                           |

#### `POST /` · `reportScenarioEvent`

Create a new scenario event

Permission `scenarios:create`. Declared at `src/transport/scenario-event.rest.ts:24`.

Answers at `/api/scenario-events`, `/api/v1/scenario-events`; also, undocumented, `/api/scenario-events/2026-08-07`, `/api/v1/scenario-events/2026-08-07`, `/api/scenario-events/latest`, `/api/v1/scenario-events/latest`.

```typescript
type Body = z.infer<typeof scenarioEventSchema>; // ../contract/src/schemas/event-schemas.ts:446
// Response: inline, src/transport/scenario-event.rest.ts:27
interface Response {
  success: boolean;
  url?: string | null;
}
```

#### `POST /browser-tab` · `offerScenarioBrowserTab`

Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live tab took it.

Permission `scenarios:create`. Declared at `src/transport/scenario-event.rest.ts:49`.

Answers at `/api/scenario-events/browser-tab`, `/api/v1/scenario-events/browser-tab`; also, undocumented, `/api/scenario-events/2026-08-07/browser-tab`, `/api/v1/scenario-events/2026-08-07/browser-tab`, `/api/scenario-events/latest/browser-tab`, `/api/v1/scenario-events/latest/browser-tab`.

```typescript
// Body: scenarioEventBrowserTabBodySchema, ../contract/src/scenario-event.schemas.ts:4
interface Body {
  tabKey: string;
  batchRunId: string;
  scenarioSetId?: string;
}
// Response: inline, src/transport/scenario-event.rest.ts:52
interface Response {
  delivered: boolean;
  url: string;
}
```

#### `DELETE /` · `archiveScenarioEvents`

Archive simulation runs. Pass exactly one of scenarioSetId (archives every run in the set; scenarioSetId=default targets the implicit default set) or scenarioRunId (archives that one run).

Permission `scenarios:manage`. Declared at `src/transport/scenario-event.rest.ts:67`.

Answers at `/api/scenario-events`, `/api/v1/scenario-events`; also, undocumented, `/api/scenario-events/2026-08-07`, `/api/v1/scenario-events/2026-08-07`, `/api/scenario-events/latest`, `/api/v1/scenario-events/latest`.

```typescript
// Query: scenarioEventArchiveQuerySchema, ../contract/src/scenario-event.schemas.ts:23
interface Query {
  scenarioSetId?: string;
  scenarioRunId?: string;
}
// Response: scenarioEventArchiveOutputSchema, ../contract/src/scenario-event.schemas.ts:15
interface Response {
  archived: number;
  failed: number;
  scenarioSetId?: string;
  hasMore?: boolean;
  scenarioRunId?: string;
}
```

### `scenarioGenerateRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/scenario-generate.rest.ts:10` |
| Base URL    | none: each route's path is its address       |
| Addressing  | literal                                      |
| Credential  | browser                                      |

#### `POST /api/scenario/generate` · `generateScenario`

Generate or refine a scenario with the author-assist model

Permission `scenarios:manage`. Declared at `src/transport/scenario-generate.rest.ts:15`.

Answers at `/api/scenario/generate`.

```typescript
// Body: scenarioGenerateRequestSchema, ../contract/src/scenario-generate.schemas.ts:17
interface Body {
  prompt: string;
  currentScenario: {
    name: string;
    situation: string;
    criteria: string[];
  } | null;
  projectId: string;
}
// Response: scenarioGenerateResponseSchema, ../contract/src/scenario-generate.schemas.ts:30
interface Response {
  scenario: {
    name: string;
    situation: string;
    criteria: string[];
  };
}
```

### `scenarioRunExportRest`

|             |                                               |
| ----------- | --------------------------------------------- |
| Declared at | `src/transport/scenario-run-export.rest.ts:8` |
| Base URL    | none: each route's path is its address        |
| Addressing  | literal                                       |
| Credential  | browser                                       |

#### `POST /api/export/scenario-runs/download` · `downloadScenarioRunExport`

Stream a project's simulation run history as gzipped CSV

Permission `scenarios:view`. Declared at `src/transport/scenario-run-export.rest.ts:13`.

Answers at `/api/export/scenario-runs/download`.

```typescript
// Body: scenarioRunExportRequestSchema, ../contract/src/features/run/scenario-run-export.ts:17
interface Body {
  projectId: string;
  mode: "full" | "criteria";
  scenarioSetId?: string;
  scenarioId?: string;
  passFailStatus?: "pass" | "fail" | "stalled";
  startDate?: number;
  endDate?: number;
}
// Response: inline, src/transport/scenario-run-export.rest.ts:17
type Response = unknown;
```

### `scenarioVoiceRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/scenario-voice.rest.ts:20` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | browser                                   |

#### `POST /api/voice/session` · `mintVoiceSession`

Mint a signed-URL session for a browser voice call

Authenticated: The voice flag and scenarios:create are checked in the app; evaluations:manage only when the call creates an agent, which a finish learns from its verified session token (#8021). Declared at `src/transport/scenario-voice.rest.ts:25`.

Answers at `/api/voice/session`.

```typescript
// Body: voiceSessionMintInputSchema, ../contract/src/voice/voice-session.schemas.ts:6
interface Body {
  projectId: string;
  transport: "elevenlabs_convai" | "phone";
  agentId: string;
  agentRowId?: string;
}
// Response: voiceSessionMintResultSchema, ../contract/src/voice/voice-session.schemas.ts:40
interface Response {
  transport: "elevenlabs_convai" | "phone";
  sessionToken: string;
  maxDurationSeconds: number;
  connect: {
    signedUrl: string;
  };
}
```

#### `POST /api/voice/session/:sessionId/finish` · `finishVoiceSession`

Ingest a finished browser voice call as a scenario run

Authenticated: The voice flag and scenarios:create are checked in the app; evaluations:manage only when the call creates an agent, which a finish learns from its verified session token (#8021). Declared at `src/transport/scenario-voice.rest.ts:31`.

Answers at `/api/voice/session/:sessionId/finish`.

```typescript
// Params: voiceSessionFinishParamsSchema, ../contract/src/voice/voice-session.schemas.ts:37
interface Params {
  sessionId: string;
}
type Body = z.infer<typeof voiceSessionFinishInputSchema>; // ../contract/src/voice/voice-session.schemas.ts:22
// Response: voiceSessionFinishResultSchema, ../contract/src/voice/voice-session.schemas.ts:49
interface Response {
  runId: string;
  agentId: string;
  source: "provider" | "browser";
  hasFetchFailed: boolean;
  hasAudio: boolean;
  audioUrl?: string;
  scenarioSetId?: string;
}
```

#### `GET /api/voice/session/:conversationId/audio` · `streamVoiceSessionAudio`

Stream a voice call's recording from its provider

Permission `scenarios:view`. Declared at `src/transport/scenario-voice.rest.ts:40`.

Answers at `/api/voice/session/:conversationId/audio`.

```typescript
// Params: voiceSessionAudioParamsSchema, ../contract/src/voice/voice-session.schemas.ts:69
interface Params {
  conversationId: string;
}
// Query: voiceSessionAudioQuerySchema, ../contract/src/voice/voice-session.schemas.ts:72
interface Query {
  projectId: string;
}
// Response: inline, src/transport/scenario-voice.rest.ts:44
type Response = unknown;
```

#### `GET /api/voice/run/:scenarioRunId/audio` · `streamVoiceRunAudio`

Stream a headless voice run's whole-call recording from its provider

Permission `scenarios:view`. Declared at `src/transport/scenario-voice.rest.ts:59`.

Answers at `/api/voice/run/:scenarioRunId/audio`.

```typescript
// Params: voiceRunAudioParamsSchema, ../contract/src/voice/voice-session.schemas.ts:80
interface Params {
  scenarioRunId: string;
}
type Query = z.infer<typeof voiceSessionAudioQuerySchema>; // ../contract/src/voice/voice-session.schemas.ts:72
// Response: inline, src/transport/scenario-voice.rest.ts:63
type Response = unknown;
```

### `createScenarioRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/scenario.rest.ts:130`       |
| Base URL    | `/api/scenarios`, twin `/api/v1/scenarios` |
| Addressing  | dated                                      |
| Credential  | project                                    |
| Versions    | `2026-08-07`                               |

#### `GET /` · `getApiScenarios`

Get all scenarios for a project

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:135`.

Answers at `/api/scenarios`, `/api/v1/scenarios`; also, undocumented, `/api/scenarios/2026-08-07`, `/api/v1/scenarios/2026-08-07`, `/api/scenarios/latest`, `/api/v1/scenarios/latest`.

```typescript
// Response: z.array(scenarioRestResponseWithPlatformUrlSchema) (inline, src/transport/scenario.rest.ts:137)
```

#### `GET /:id` · `getApiScenariosById`

Get a specific scenario by ID

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:156`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
// Params: scenarioRestIdParamsSchema, ../contract/src/scenario-rest.schemas.ts:197
interface Params {
  id: string;
}
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `POST /` · `postApiScenarios`

Create a new scenario

Permission `scenarios:create`. Declared at `src/transport/scenario.rest.ts:180`.

Answers at `/api/scenarios`, `/api/v1/scenarios`; also, undocumented, `/api/scenarios/2026-08-07`, `/api/v1/scenarios/2026-08-07`, `/api/scenarios/latest`, `/api/v1/scenarios/latest`.

```typescript
type Body = z.infer<typeof scenarioRestCreateSchema>; // ../contract/src/scenario-rest.schemas.ts:154
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `PUT /:id` · `putApiScenariosById`

Update an existing scenario

Permission `scenarios:update`. Declared at `src/transport/scenario.rest.ts:226`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Body = z.infer<typeof scenarioRestUpdateSchema>; // ../contract/src/scenario-rest.schemas.ts:177
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `PATCH /:id` · `patchApiScenariosById`

Update an existing scenario

Permission `scenarios:update`. Declared at `src/transport/scenario.rest.ts:256`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Body = z.infer<typeof scenarioRestUpdateSchema>; // ../contract/src/scenario-rest.schemas.ts:177
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `DELETE /:id` · `deleteApiScenariosById`

Archive (soft-delete) a scenario

Permission `scenarios:manage`. Declared at `src/transport/scenario.rest.ts:289`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
// Response: scenarioRestArchivedSchema, ../contract/src/scenario-rest.schemas.ts:202
interface Response {
  id: string;
  archived: boolean;
}
```

#### `GET /:id/versions` · `getApiScenariosByIdVersions`

List the saved versions of a scenario, newest first. A scenario saved before versions were recorded closes its history with a synthesized Created entry.

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:305`.

Answers at `/api/scenarios/:id/versions`, `/api/v1/scenarios/:id/versions`; also, undocumented, `/api/scenarios/2026-08-07/:id/versions`, `/api/v1/scenarios/2026-08-07/:id/versions`, `/api/scenarios/latest/:id/versions`, `/api/v1/scenarios/latest/:id/versions`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
// Query: scenarioRestListVersionsQuerySchema, ../contract/src/scenario-rest.schemas.ts:129
interface Query {
  limit?: number;
  cursor?: number;
}
// Response: scenarioRestVersionListResponseSchema, ../contract/src/scenario-rest.schemas.ts:97
interface Response {
  versions: {
    version: number;
    authorLabel: string | null;
    authorId: string | null;
    changeDescription: string | null;
    changedFields: string[];
    createdAt: string;
    isSynthesized: boolean;
  }[];
  nextCursor: number | null;
}
```

#### `GET /:id/versions/:version` · `getApiScenariosByIdVersionsByVersion`

Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as that version saved them.

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:343`.

Answers at `/api/scenarios/:id/versions/:version`, `/api/v1/scenarios/:id/versions/:version`; also, undocumented, `/api/scenarios/2026-08-07/:id/versions/:version`, `/api/v1/scenarios/2026-08-07/:id/versions/:version`, `/api/scenarios/latest/:id/versions/:version`, `/api/v1/scenarios/latest/:id/versions/:version`.

```typescript
// Params: scenarioRestIdVersionParamsSchema, ../contract/src/scenario-rest.schemas.ts:198
interface Params {
  id: string;
  version: number;
}
type Response = z.infer<typeof scenarioRestVersionDetailResponseSchema>; // ../contract/src/scenario-rest.schemas.ts:106
```

### `createSimulationRunsRest`

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| Declared at | `src/transport/simulation-run.rest.ts:50`              |
| Base URL    | `/api/simulation-runs`, twin `/api/v1/simulation-runs` |
| Addressing  | dated                                                  |
| Credential  | project                                                |
| Versions    | `2026-08-07`                                           |

#### `GET /` · `getApiSimulationRuns`

List simulation runs, optionally filtered by scenarioSetId or batchRunId. Set-level and unfiltered listings trim each run to its first few messages and report the trim as `messagesTruncated`; pass `include=messages` to read whole conversations, which caps the page at 20 runs, ending on a batch boundary. A batch-scoped listing always carries whole conversations.

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:54`.

Answers at `/api/simulation-runs`, `/api/v1/simulation-runs`; also, undocumented, `/api/simulation-runs/2026-08-07`, `/api/v1/simulation-runs/2026-08-07`, `/api/simulation-runs/latest`, `/api/v1/simulation-runs/latest`.

```typescript
// Query: simulationRunListQuerySchema, ../contract/src/features/simulation/simulation-run.schemas.ts:112
interface Query {
  scenarioSetId?: string;
  batchRunId?: string;
  limit?: number;
  cursor?: string;
  include?: "messages";
}
type Response = z.infer<typeof simulationRunListResponseSchema>; // ../contract/src/features/simulation/simulation-run.schemas.ts:134
```

#### `GET /:scenarioRunId` · `getApiSimulationRunsByScenarioRunId`

Get a single simulation run by its ID

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:73`.

Answers at `/api/simulation-runs/:scenarioRunId`, `/api/v1/simulation-runs/:scenarioRunId`; also, undocumented, `/api/simulation-runs/2026-08-07/:scenarioRunId`, `/api/v1/simulation-runs/2026-08-07/:scenarioRunId`, `/api/simulation-runs/latest/:scenarioRunId`, `/api/v1/simulation-runs/latest/:scenarioRunId`.

```typescript
// Params: scenarioRunIdParamsSchema, ../contract/src/features/simulation/simulation-run.schemas.ts:131
interface Params {
  scenarioRunId: string;
}
type Response = z.infer<typeof scenarioRunRestResponseWithPlatformUrlSchema>; // ../contract/src/features/simulation/simulation-run.schemas.ts:79
```

#### `GET /batches/list` · `getApiSimulationRunsBatchesList`

List batch summaries for a scenario set (pass/fail counts per batch)

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:92`.

Answers at `/api/simulation-runs/batches/list`, `/api/v1/simulation-runs/batches/list`; also, undocumented, `/api/simulation-runs/2026-08-07/batches/list`, `/api/v1/simulation-runs/2026-08-07/batches/list`, `/api/simulation-runs/latest/batches/list`, `/api/v1/simulation-runs/latest/batches/list`.

```typescript
// Query: simulationBatchQuerySchema, ../contract/src/features/simulation/simulation-run.schemas.ts:125
interface Query {
  scenarioSetId: string;
  limit?: number;
  cursor?: string;
}
type Response = z.infer<typeof simulationBatchListResponseSchema>; // ../contract/src/features/simulation/simulation-run.schemas.ts:140
```

#### `GET /batches/:batchRunId` · `getApiSimulationRunsBatchesByBatchRunId`

Get the summary of a single batch run, including its completion flag

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:118`.

Answers at `/api/simulation-runs/batches/:batchRunId`, `/api/v1/simulation-runs/batches/:batchRunId`; also, undocumented, `/api/simulation-runs/2026-08-07/batches/:batchRunId`, `/api/v1/simulation-runs/2026-08-07/batches/:batchRunId`, `/api/simulation-runs/latest/batches/:batchRunId`, `/api/v1/simulation-runs/latest/batches/:batchRunId`.

```typescript
// Params: batchRunIdParamsSchema, ../contract/src/features/simulation/simulation-run.schemas.ts:132
interface Params {
  batchRunId: string;
}
type Response = z.infer<typeof simulationBatchSummaryRestSchema>; // ../contract/src/features/simulation/simulation-run.schemas.ts:84
```

## tRPC transport

### `scenarios`

Contract `../contract/src/scenario.trpc.ts:169`, router `src/transport/scenario.trpc.ts:40`.

| Procedure                               | Kind         | Gate                                                                                                                                                                                                                                | Input                               | Output                               |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------ |
| `scenarios.create`                      | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | `scenarioTrpcCreateSchema`          | `scenarioSchema`                     |
| `scenarios.getAll`                      | query        | Permission `scenarios:view`                                                                                                                                                                                                         | `projectSchema`                     | inline                               |
| `scenarios.getById`                     | query        | Permission `scenarios:view`                                                                                                                                                                                                         | `scenarioIdSchema`                  | `scenarioSchema`                     |
| `scenarios.getByIdIncludingArchived`    | query        | Permission `scenarios:view`                                                                                                                                                                                                         | `scenarioIdSchema`                  | inline                               |
| `scenarios.update`                      | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | `scenarioTrpcUpdateSchema`          | `scenarioSchema`                     |
| `scenarios.archive`                     | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | `scenarioIdSchema`                  | `scenarioSchema`                     |
| `scenarios.moveToTestSuite`             | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | inline                              | `scenarioSchema`                     |
| `scenarios.duplicate`                   | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | inline                              | `scenarioSchema`                     |
| `scenarios.batchArchive`                | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | inline                              | `scenarioBatchArchiveResultSchema`   |
| `scenarios.listVersions`                | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `scenarioVersionPageSchema`          |
| `scenarios.getVersion`                  | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `scenarioVersionDetailSchema`        |
| `scenarios.restoreVersion`              | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | inline                              | `scenarioSchema`                     |
| `scenarios.run`                         | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | `scenarioTrpcRunSchema`             | `scenarioRunScheduledSchema`         |
| `scenarios.cancelJob`                   | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | inline                              | `scenarioCancelJobResultSchema`      |
| `scenarios.cancelBatchRun`              | mutation     | Permission `scenarios:manage`                                                                                                                                                                                                       | inline                              | `scenarioCancelBatchRunResultSchema` |
| `scenarios.getScenarioSetsData`         | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | inline                               |
| `scenarios.getSuiteRunData`             | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationAllSuitesRunDataSchema`   |
| `scenarios.getLastResultSummaries`      | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | inline                               |
| `scenarios.getSuiteRunFreshness`        | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationRunFreshnessSchema`       |
| `scenarios.getScenarioSetRunData`       | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationScenarioSetRunDataSchema` |
| `scenarios.getAllScenarioSetRunData`    | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | inline                               |
| `scenarios.getRunState`                 | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationRunDataSchema`            |
| `scenarios.getScenarioSetBatchRunCount` | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationBatchRunCountSchema`      |
| `scenarios.getScenarioSetBatchHistory`  | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationBatchHistorySchema`       |
| `scenarios.getBatchRunData`             | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationBatchRunDataSchema`       |
| `scenarios.getExternalSetSummaries`     | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | inline                               |
| `scenarios.getAllSuiteRunData`          | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationAllSuitesRunDataSchema`   |
| `scenarios.onSimulationUpdate`          | subscription | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `simulationStreamFrameSchema`        |
| `scenarios.getCodeScenarios`            | query        | Permission `scenarios:view`                                                                                                                                                                                                         | `windowSchema`                      | inline                               |
| `scenarios.getRunTargets`               | query        | Permission `scenarios:view`                                                                                                                                                                                                         | `windowSchema`                      | inline                               |
| `scenarios.getResultsOverview`          | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `resultsOverviewSchema`              |
| `scenarios.getResultAtoms`              | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | `resultAtomsPageSchema`              |
| `scenarios.getRunConfigurations`        | query        | Permission `scenarios:view`                                                                                                                                                                                                         | inline                              | inline                               |
| `scenarios.mintVoiceSession`            | mutation     | Service-authorized: scenarios:create, evaluations:manage; The voice flag and scenarios:create are checked in the app; evaluations:manage only when the call creates an agent, which a finish learns from its verified session token | `voiceSessionMintInputSchema`       | `voiceSessionMintResultSchema`       |
| `scenarios.finishVoiceSession`          | mutation     | Service-authorized: scenarios:create, evaluations:manage; The voice flag and scenarios:create are checked in the app; evaluations:manage only when the call creates an agent, which a finish learns from its verified session token | `voiceSessionFinishInputSchema`     | `voiceSessionFinishResultSchema`     |
| `scenarios.testAgentTurn`               | mutation     | Permission `evaluations:manage`                                                                                                                                                                                                     | `agentApiTestTurnInputSchema`       | `agentTestTurnResultSchema`          |
| `scenarios.testAgentRun`                | mutation     | Permission `scenarios:create`                                                                                                                                                                                                       | `agentApiAgentReferenceInputSchema` | `agentTestRunResultSchema`           |
| `scenarios.testHttpAgent`               | mutation     | Permission `evaluations:manage`                                                                                                                                                                                                     | `httpAgentTestInputSchema`          | `httpProxyResultSchema`              |

```typescript
// scenarios.create
type Input = z.infer<typeof scenarioTrpcCreateSchema>; // ../contract/src/scenario.trpc.ts:77
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.getAll
// Input: projectSchema, ../contract/src/scenario.trpc.ts:67
interface Input {
  projectId: string;
}
// Output: scenarioSchema.array() (inline, ../contract/src/scenario.trpc.ts:177)

// scenarios.getById
// Input: scenarioIdSchema, ../contract/src/scenario.trpc.ts:75
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.getByIdIncludingArchived
type Input = z.infer<typeof scenarioIdSchema>; // ../contract/src/scenario.trpc.ts:75
// Output: scenarioSchema.nullable() (inline, ../contract/src/scenario.trpc.ts:185)

// scenarios.update
type Input = z.infer<typeof scenarioTrpcUpdateSchema>; // ../contract/src/scenario.trpc.ts:102
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.archive
type Input = z.infer<typeof scenarioIdSchema>; // ../contract/src/scenario.trpc.ts:75
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.moveToTestSuite
// Input: inline, ../contract/src/scenario.trpc.ts:198
interface Input {
  projectId: string;
  scenarioId: string;
  testSuiteId: string | null;
}
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.duplicate
// Input: inline, ../contract/src/scenario.trpc.ts:207
interface Input {
  projectId: string;
  scenarioId: string;
}
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.batchArchive
// Input: inline, ../contract/src/scenario.trpc.ts:211
interface Input {
  projectId: string;
  ids: string[];
}
// Output: scenarioBatchArchiveResultSchema, ../contract/src/scenario.responses.ts:53
interface Output {
  archived: string[];
  failed: {
    id: string;
    error: string;
  }[];
}

// scenarios.listVersions
// Input: inline, ../contract/src/scenario.trpc.ts:217
interface Input {
  projectId: string;
  scenarioId: string;
  limit?: number;
  cursor?: number;
}
type Output = z.infer<typeof scenarioVersionPageSchema>; // ../contract/src/scenario.responses.ts:18

// scenarios.getVersion
// Input: inline, ../contract/src/scenario.trpc.ts:228
interface Input {
  projectId: string;
  scenarioId: string;
  version: number;
}
type Output = z.infer<typeof scenarioVersionDetailSchema>; // ../contract/src/scenario.version.ts:132

// scenarios.restoreVersion
// Input: inline, ../contract/src/scenario.trpc.ts:234
interface Input {
  projectId: string;
  scenarioId: string;
  version: number;
}
type Output = z.infer<typeof scenarioSchema>; // ../contract/src/scenario.ts:29

// scenarios.run
// Input: scenarioTrpcRunSchema, ../contract/src/scenario.trpc.ts:128
interface Input {
  projectId: string;
  scenarioId: string;
  target: {
    type: "prompt" | "http" | "code" | "workflow" | "connected" | "voice";
    referenceId: string;
  };
  setId?: string;
  batchRunId?: string;
  parameters?: Record<string, string | number | boolean>;
  note?: string;
}
// Output: scenarioRunScheduledSchema, ../contract/src/scenario.responses.ts:42
interface Output {
  scheduled: true;
  setId: string;
  batchRunId: string;
  scenarioRunId: string;
}

// scenarios.cancelJob
// Input: inline, ../contract/src/scenario.trpc.ts:249
interface Input {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
  scenarioRunId: string;
  scenarioId: string;
}
// Output: scenarioCancelJobResultSchema, ../contract/src/scenario.responses.ts:29
interface Output {
  cancelled: boolean;
}

// scenarios.cancelBatchRun
// Input: inline, ../contract/src/scenario.trpc.ts:261
interface Input {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}
// Output: scenarioCancelBatchRunResultSchema, ../contract/src/scenario.responses.ts:33
interface Output {
  cancelledCount: number;
  skippedCount: number;
}

// scenarios.getScenarioSetsData
// Input: inline, ../contract/src/scenario.trpc.ts:267
interface Input {
  projectId: string;
  startDate?: number;
  endDate?: number;
}
// Output: inline, ../contract/src/scenario.trpc.ts:268
type Output = {
  scenarioSetId: string;
  scenarioCount: number;
  lastRunAt: number;
}[];

// scenarios.getSuiteRunData
// Input: inline, ../contract/src/scenario.trpc.ts:273
interface Input {
  projectId: string;
  scenarioSetId?: string;
  limit?: number;
  cursor?: string;
  sinceTimestamp?: number;
  startDate?: number;
  endDate?: number;
}
type Output = z.infer<typeof simulationAllSuitesRunDataSchema>; // ../contract/src/features/simulation/simulation.ts:222

// scenarios.getLastResultSummaries
// Input: inline, ../contract/src/scenario.trpc.ts:291
interface Input {
  projectId: string;
  scenarioIds?: string[];
  startDate?: number;
  endDate?: number;
}
// Output: simulationLastResultSummarySchema.array() (inline, ../contract/src/scenario.trpc.ts:297)

// scenarios.getSuiteRunFreshness
// Input: inline, ../contract/src/scenario.trpc.ts:314
interface Input {
  projectId: string;
  scenarioSetId?: string;
  startDate?: number;
  endDate?: number;
}
// Output: simulationRunFreshnessSchema, ../contract/src/features/simulation/simulation.ts:252
interface Output {
  lastUpdatedAt: number;
}

// scenarios.getScenarioSetRunData
// Input: inline, ../contract/src/scenario.trpc.ts:320
interface Input {
  projectId: string;
  scenarioSetId: string;
  limit?: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
}
type Output = z.infer<typeof simulationScenarioSetRunDataSchema>; // ../contract/src/features/simulation/simulation.ts:245

// scenarios.getAllScenarioSetRunData
// Input: inline, ../contract/src/scenario.trpc.ts:332
interface Input {
  projectId: string;
  scenarioSetId: string;
  startDate?: number;
  endDate?: number;
}
// Output: simulationRunDataSchema.array() (inline, ../contract/src/scenario.trpc.ts:333)

// scenarios.getRunState
// Input: inline, ../contract/src/scenario.trpc.ts:336
interface Input {
  projectId: string;
  scenarioRunId: string;
}
type Output = z.infer<typeof simulationRunDataSchema>; // ../contract/src/features/simulation/simulation.ts:114

// scenarios.getScenarioSetBatchRunCount
// Input: inline, ../contract/src/scenario.trpc.ts:340
interface Input {
  projectId: string;
  scenarioSetId: string;
  startDate?: number;
  endDate?: number;
}
// Output: simulationBatchRunCountSchema, ../contract/src/features/simulation/simulation.ts:255
interface Output {
  count: number;
}

// scenarios.getScenarioSetBatchHistory
// Input: inline, ../contract/src/scenario.trpc.ts:345
interface Input {
  projectId: string;
  scenarioSetId: string;
  limit?: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
}
type Output = z.infer<typeof simulationBatchHistorySchema>; // ../contract/src/features/simulation/simulation.ts:202

// scenarios.getBatchRunData
// Input: inline, ../contract/src/scenario.trpc.ts:359
interface Input {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
  sinceTimestamp?: number;
  runTimestamps?: Record<string, number>;
}
type Output = z.infer<typeof simulationBatchRunDataSchema>; // ../contract/src/features/simulation/simulation.ts:211

// scenarios.getExternalSetSummaries
// Input: inline, ../contract/src/scenario.trpc.ts:377
interface Input {
  projectId: string;
  startDate?: number;
  endDate?: number;
}
// Output: inline, ../contract/src/scenario.trpc.ts:378
type Output = {
  scenarioSetId: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  lastRunTimestamp: number;
}[];

// scenarios.getAllSuiteRunData
// Input: inline, ../contract/src/scenario.trpc.ts:383
interface Input {
  projectId: string;
  limit?: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
}
type Output = z.infer<typeof simulationAllSuitesRunDataSchema>; // ../contract/src/features/simulation/simulation.ts:222

// scenarios.onSimulationUpdate
// Input: inline, ../contract/src/scenario.trpc.ts:399
interface Input {
  projectId: string;
  tabKey?: string;
  tabId?: string;
}
// Output: simulationStreamFrameSchema, ../contract/src/features/simulation/simulation.ts:262
interface Output {
  event: unknown;
  timestamp?: number;
}

// scenarios.getCodeScenarios
// Input: windowSchema, ../contract/src/scenario.trpc.ts:163
interface Input {
  projectId: string;
  startDate?: number;
  endDate?: number;
}
// Output: inline, ../contract/src/scenario.trpc.ts:414
type Output = {
  key: string;
  name: string;
}[];

// scenarios.getRunTargets
type Input = z.infer<typeof windowSchema>; // ../contract/src/scenario.trpc.ts:163
// Output: inline, ../contract/src/scenario.trpc.ts:422
type Output = {
  key: string;
  referenceId: string | null;
  parameters: Record<string, string | number | boolean> | null;
  name: string;
}[];

// scenarios.getResultsOverview
// Input: inline, ../contract/src/scenario.trpc.ts:433
interface Input {
  projectId: string;
  startDate?: number;
  endDate?: number;
  scenarioIds?: string[];
  labels?: string[];
  testSuiteIds?: string[];
  scenarioSetIds?: string[];
  targetKeys?: string[];
  outcome?: "passed" | "failed" | "pending";
  groupBy: "plan" | "scenario" | "target" | "none";
}
type Output = z.infer<typeof resultsOverviewSchema>; // ../contract/src/scenario.responses.ts:140

// scenarios.getResultAtoms
// Input: z.object({ ...resultsFilterSchema.shape, limit: z.number().int().min(1).max(MAX_ATOM_PAGE… (inline, ../contract/src/scenario.trpc.ts:450)
type Output = z.infer<typeof resultAtomsPageSchema>; // ../contract/src/scenario.responses.ts:89

// scenarios.getRunConfigurations
// Input: inline, ../contract/src/scenario.trpc.ts:464
interface Input {
  projectId: string;
  startDate?: number;
  endDate?: number;
  limit?: number;
}
// Output: runConfigurationEntrySchema.array() (inline, ../contract/src/scenario.trpc.ts:471)

// scenarios.mintVoiceSession
type Input = z.infer<typeof voiceSessionMintInputSchema>; // ../contract/src/voice/voice-session.schemas.ts:6
type Output = z.infer<typeof voiceSessionMintResultSchema>; // ../contract/src/voice/voice-session.schemas.ts:40

// scenarios.finishVoiceSession
type Input = z.infer<typeof voiceSessionFinishInputSchema>; // ../contract/src/voice/voice-session.schemas.ts:22
type Output = z.infer<typeof voiceSessionFinishResultSchema>; // ../contract/src/voice/voice-session.schemas.ts:49

// scenarios.testAgentTurn
// Input: agentApiTestTurnInputSchema, ../../agent/contract/src/agent.schemas.ts:25
interface Input {
  id: string;
  projectId: string;
  message: string;
  params?: Record<string, string | number | boolean>;
}
// Output: agentTestTurnResultSchema, ../../agent/contract/src/agent.queries.ts:169
interface Output {
  output: unknown;
  durationMs: number;
  instance: {
    hostname: string;
    label: string | null;
  } | null;
}

// scenarios.testAgentRun
// Input: agentApiAgentReferenceInputSchema, ../../agent/contract/src/agent.schemas.ts:19
interface Input {
  projectId: string;
  agentId: string;
}
// Output: agentTestRunResultSchema, ../../agent/contract/src/agent.queries.ts:176
interface Output {
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
}

// scenarios.testHttpAgent
type Input = z.infer<typeof httpAgentTestInputSchema>; // ../../agent/contract/src/agent.commands.ts:15
type Output = z.infer<typeof httpProxyResultSchema>; // ../../agent/contract/src/agent.queries.ts:185
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `scenario_lifecycle` (aggregate `scenario`)

Declared at `src/eventing/scenario-lifecycle.pipeline.ts:30`. Events: `scenarioCreatedEventSchema`.

| Kind    | Name                    | Handles | Declared at                                      |
| ------- | ----------------------- | ------- | ------------------------------------------------ |
| command | `recordScenarioCreated` | –       | `src/eventing/scenario-lifecycle.pipeline.ts:37` |

### Pipeline `simulation_processing` (aggregate `simulation_run`)

Declared at `src/eventing/simulation-processing.pipeline.ts:120`. Events: `SimulationRunQueuedEventSchema`, `SimulationRunStartedEventSchema`, `SimulationMessageSnapshotEventSchema`, `SimulationRunFinishedEventSchema`, `SimulationRunEvaluatedEventSchema`, `SimulationTextMessageStartEventSchema`, `SimulationTextMessageEndEventSchema`, `SimulationRunMetricsComputedEventSchema`, `SimulationRunCancelRequestedEventSchema`, `SimulationRunAgentInstanceRecordedEventSchema`, `SimulationRunCutAtLimitRecordedEventSchema`, `SimulationRunDeletedEventSchema`, `SimulationSetArchivedEventSchema`.

| Kind                       | Name                                                                                    | Handles                                                                                                                                                                                                                                                                                           | Declared at                                          |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:176` |
| command                    | `startRun`                                                                              | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:181` |
| command                    | `messageSnapshot`                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:182` |
| command                    | `textMessageStart`                                                                      | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:183` |
| command                    | `textMessageEnd`                                                                        | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:184` |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:185` |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:190` |
| command                    | `cancelRun`                                                                             | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:195` |
| command                    | `deleteRun`                                                                             | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:196` |
| command                    | `recordAgentInstance`                                                                   | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:197` |
| command                    | `recordCutAtLimit`                                                                      | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:198` |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:199` |
| process manager            | `≈ deps.scenarioRunExecution.name`                                                      | ≈ applier `deps.scenarioRunExecution.process`                                                                                                                                                                                                                                                     | `src/eventing/simulation-processing.pipeline.ts:174` |
| process manager            | `≈ deps.scenarioEvaluations.name`                                                       | ≈ applier `deps.scenarioEvaluations.process`                                                                                                                                                                                                                                                      | `src/eventing/simulation-processing.pipeline.ts:175` |
| subscriber                 | `snapshotUpdateBroadcast`                                                               | `lw.simulation_run.queued`, `lw.simulation_run.started`, `lw.simulation_run.message_snapshot`, `lw.simulation_run.text_message_end`, `lw.simulation_run.finished`, `lw.simulation_run.evaluated`, `lw.simulation_run.deleted`, `lw.simulation_run.cancel_requested` from [scenario](../README.md) | `src/eventing/simulation-processing.pipeline.ts:147` |
| subscriber                 | `traceMetricsSync`                                                                      | `lw.simulation_run.finished` from [scenario](../README.md)                                                                                                                                                                                                                                        | `src/eventing/simulation-processing.pipeline.ts:151` |
| peer subscriber            | `traceSpanMetricsSync`                                                                  | `lw.obs.trace.span_received` from [trace](../../trace/README.md)                                                                                                                                                                                                                                  | `src/eventing/simulation-processing.pipeline.ts:155` |
| ClickHouse fold projection | `≈ SimulationRunStateFoldProjection.create({ store: deps.simulationRunStore })`         | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:141` |
| ClickHouse map projection  | `≈ SimulationRunMetricsMapProjection.create({ store: deps.simulationRunMetricsStore })` | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:144` |
| lane aliases               | `≈ mainSimulationLaneAliases({ evaluationsProcess: deps.scenarioEvaluations.name })`    | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:213` |
| retention                  | `≈ deps.retention`                                                                      | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:216` |

## Configuration

| Kind   | Leaf                                                  | Environment variable                      | Declared at                              |
| ------ | ----------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| secret | `voiceSessionSigning`                                 | `CREDENTIALS_SECRET`                      | `src/app/scenario.app.ts:272`            |
| secret | `voiceSessionSigningFallback`                         | `NEXTAUTH_SECRET`                         | `src/app/scenario.app.ts:273`            |
| secret | `nlpInternal`                                         | `LANGWATCH_NLP_INTERNAL_SECRET`           | `src/app/scenario.app.ts:275`            |
| config | `langwatchEndpoint`                                   | `LANGWATCH_ENDPOINT`                      | `../contract/src/scenario.config.ts:95`  |
| config | `voicePublicBaseUrl`                                  | `VOICE_PUBLIC_BASE_URL`                   | `../contract/src/scenario.config.ts:97`  |
| config | `voiceTunnel`                                         | `VOICE_TUNNEL`                            | `../contract/src/scenario.config.ts:99`  |
| config | `isSaas`                                              | `IS_SAAS`                                 | `../contract/src/scenario.config.ts:101` |
| config | `nodeEnvironment`                                     | `NODE_ENV`                                | `../contract/src/scenario.config.ts:103` |
| config | `voiceWorkerOnly`                                     | `VOICE_WORKER_ONLY`                       | `../contract/src/scenario.config.ts:105` |
| config | `consumedResourceClasses`                             | `SCENARIO_CONSUMED_RESOURCE_CLASSES`      | `../contract/src/scenario.config.ts:107` |
| config | `slotBudget`                                          | `SCENARIO_SLOT_BUDGET`                    | `../contract/src/scenario.config.ts:109` |
| config | `generateTimeoutMs`                                   | `SCENARIO_GENERATE_TIMEOUT_MS`            | `../contract/src/scenario.config.ts:111` |
| config | `voiceCallMaxSeconds`                                 | `VOICE_CALL_MAX_SECONDS`                  | `../contract/src/scenario.config.ts:113` |
| config | `allowLoopbackVoiceProviders`                         | `VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS`   | `../contract/src/scenario.config.ts:115` |
| config | `blockLocalHttpCalls`                                 | `BLOCK_LOCAL_HTTP_CALLS`                  | `../contract/src/scenario.config.ts:116` |
| config | `allowedProxyHosts`                                   | `ALLOWED_PROXY_HOSTS`                     | `../contract/src/scenario.config.ts:117` |
| config | `defaultModel`                                        | `LANGWATCH_DEFAULT_MODEL`                 | `../contract/src/scenario.config.ts:118` |
| config | `nlpServiceUrl`                                       | `LANGWATCH_NLP_SERVICE`                   | `../contract/src/scenario.config.ts:120` |
| config | `nlpCodeBlockTimeoutSeconds`                          | `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS` | `../contract/src/scenario.config.ts:122` |
| config | `publicBaseUrl`                                       | `BASE_HOST`                               | `../contract/src/scenario.config.ts:124` |
| config | `rawSocketPort`                                       | `VOICE_WS_PORT`                           | `../contract/src/scenario.config.ts:126` |
| config | `nlpTimeouts.maxTimeoutMs`                            | `NLP_FETCH_MAX_TIMEOUT_MS`                | `../contract/src/scenario.config.ts:129` |
| config | `childParentEnvironment.path`                         | `PATH`                                    | `../contract/src/scenario.config.ts:132` |
| config | `childParentEnvironment.home`                         | `HOME`                                    | `../contract/src/scenario.config.ts:133` |
| config | `childParentEnvironment.user`                         | `USER`                                    | `../contract/src/scenario.config.ts:134` |
| config | `childParentEnvironment.shell`                        | `SHELL`                                   | `../contract/src/scenario.config.ts:135` |
| config | `childParentEnvironment.lang`                         | `LANG`                                    | `../contract/src/scenario.config.ts:136` |
| config | `childParentEnvironment.lcAll`                        | `LC_ALL`                                  | `../contract/src/scenario.config.ts:137` |
| config | `childParentEnvironment.term`                         | `TERM`                                    | `../contract/src/scenario.config.ts:138` |
| config | `childParentEnvironment.nodeCompileCache`             | `NODE_COMPILE_CACHE`                      | `../contract/src/scenario.config.ts:139` |
| config | `childParentEnvironment.corepackEnableDownloadPrompt` | `COREPACK_ENABLE_DOWNLOAD_PROMPT`         | `../contract/src/scenario.config.ts:140` |
| config | `childParentEnvironment.nodeExtraCaCerts`             | `NODE_EXTRA_CA_CERTS`                     | `../contract/src/scenario.config.ts:141` |
| config | `childParentEnvironment.logSettings`                  | `LOG_LEVEL`                               | `../contract/src/scenario.config.ts:143` |

<!-- readme:generated:end -->
