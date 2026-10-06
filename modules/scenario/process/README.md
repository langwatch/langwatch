# @langwatch/scenario-process

The server half of [scenario](../README.md). Scenarios and simulations: authored scenarios, their runs and events, exports, and the voice sessions a simulation uses.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("scenario").withRepositories(scenarioRepositories).withApi(ScenarioModule).withTransports(…, …, …, scenarioAgentTestRest, scenarioEventsRest, scenarioGenerateRest, scenarioRunExportRest, scenarioVoiceRest, scenarioTrpcTransport).withTransportFacts(…).withEventing(scenarioLifecycleEventing).withEventing(simulationProcessingEventing).withTasks(…)`, `src/scenario.module.ts:25`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ScenarioApi`)

The scenario application: what every scenario door calls, and what peer features such as Suite reach it by.

Peers call these through the token, declared at `../contract/src/scenario.api.ts:238`; nothing else in this package is public.

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
type Params = z.infer<typeof agentTestRestParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:205
type Body = z.infer<typeof testAgentBodySchema>; // ../contract/src/scenario-rest.schemas.ts:210
type Response = z.infer<typeof agentTestRunResponseSchema>; // ../contract/src/scenario-rest.schemas.ts:212
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
// Response: responseSchemas.success (inline, src/transport/scenario-event.rest.ts:27)
```

#### `POST /browser-tab` · `offerScenarioBrowserTab`

Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live tab took it.

Permission `scenarios:create`. Declared at `src/transport/scenario-event.rest.ts:49`.

Answers at `/api/scenario-events/browser-tab`, `/api/v1/scenario-events/browser-tab`; also, undocumented, `/api/scenario-events/2026-08-07/browser-tab`, `/api/v1/scenario-events/2026-08-07/browser-tab`, `/api/scenario-events/latest/browser-tab`, `/api/v1/scenario-events/latest/browser-tab`.

```typescript
type Body = z.infer<typeof scenarioEventBrowserTabBodySchema>; // ../contract/src/scenario-event.schemas.ts:4
// Response: responseSchemas.browserTabHandoff (inline, src/transport/scenario-event.rest.ts:52)
```

#### `DELETE /` · `archiveScenarioEvents`

Archive simulation runs. Pass exactly one of scenarioSetId (archives every run in the set; scenarioSetId=default targets the implicit default set) or scenarioRunId (archives that one run).

Permission `scenarios:manage`. Declared at `src/transport/scenario-event.rest.ts:67`.

Answers at `/api/scenario-events`, `/api/v1/scenario-events`; also, undocumented, `/api/scenario-events/2026-08-07`, `/api/v1/scenario-events/2026-08-07`, `/api/scenario-events/latest`, `/api/v1/scenario-events/latest`.

```typescript
type Query = z.infer<typeof scenarioEventArchiveQuerySchema>; // ../contract/src/scenario-event.schemas.ts:23
type Response = z.infer<typeof scenarioEventArchiveOutputSchema>; // ../contract/src/scenario-event.schemas.ts:15
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
type Body = z.infer<typeof scenarioGenerateRequestSchema>; // ../contract/src/scenario-generate.schemas.ts:17
type Response = z.infer<typeof scenarioGenerateResponseSchema>; // ../contract/src/scenario-generate.schemas.ts:30
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
type Body = z.infer<typeof scenarioRunExportRequestSchema>; // ../contract/src/scenario-run-export.ts:17
// Response: "bytes" (inline, src/transport/scenario-run-export.rest.ts:17)
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
type Body = z.infer<typeof voiceSessionMintInputSchema>; // ../contract/src/voice/voice-session.schemas.ts:6
type Response = z.infer<typeof voiceSessionMintResultSchema>; // ../contract/src/voice/voice-session.schemas.ts:40
```

#### `POST /api/voice/session/:sessionId/finish` · `finishVoiceSession`

Ingest a finished browser voice call as a scenario run

Authenticated: The voice flag and scenarios:create are checked in the app; evaluations:manage only when the call creates an agent, which a finish learns from its verified session token (#8021). Declared at `src/transport/scenario-voice.rest.ts:31`.

Answers at `/api/voice/session/:sessionId/finish`.

```typescript
type Params = z.infer<typeof voiceSessionFinishParamsSchema>; // ../contract/src/voice/voice-session.schemas.ts:37
type Body = z.infer<typeof voiceSessionFinishInputSchema>; // ../contract/src/voice/voice-session.schemas.ts:22
type Response = z.infer<typeof voiceSessionFinishResultSchema>; // ../contract/src/voice/voice-session.schemas.ts:49
```

#### `GET /api/voice/session/:conversationId/audio` · `streamVoiceSessionAudio`

Stream a voice call's recording from its provider

Permission `scenarios:view`. Declared at `src/transport/scenario-voice.rest.ts:40`.

Answers at `/api/voice/session/:conversationId/audio`.

```typescript
type Params = z.infer<typeof voiceSessionAudioParamsSchema>; // ../contract/src/voice/voice-session.schemas.ts:69
type Query = z.infer<typeof voiceSessionAudioQuerySchema>; // ../contract/src/voice/voice-session.schemas.ts:72
// Response: "bytes" (inline, src/transport/scenario-voice.rest.ts:44)
```

#### `GET /api/voice/run/:scenarioRunId/audio` · `streamVoiceRunAudio`

Stream a headless voice run's whole-call recording from its provider

Permission `scenarios:view`. Declared at `src/transport/scenario-voice.rest.ts:59`.

Answers at `/api/voice/run/:scenarioRunId/audio`.

```typescript
type Params = z.infer<typeof voiceRunAudioParamsSchema>; // ../contract/src/voice/voice-session.schemas.ts:80
type Query = z.infer<typeof voiceSessionAudioQuerySchema>; // ../contract/src/voice/voice-session.schemas.ts:72
// Response: "bytes" (inline, src/transport/scenario-voice.rest.ts:63)
```

### `createScenarioRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/scenario.rest.ts:125`       |
| Base URL    | `/api/scenarios`, twin `/api/v1/scenarios` |
| Addressing  | dated                                      |
| Credential  | project                                    |
| Versions    | `2026-08-07`                               |

#### `GET /` · `getApiScenarios`

Get all scenarios for a project

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:130`.

Answers at `/api/scenarios`, `/api/v1/scenarios`; also, undocumented, `/api/scenarios/2026-08-07`, `/api/v1/scenarios/2026-08-07`, `/api/scenarios/latest`, `/api/v1/scenarios/latest`.

```typescript
// Response: z.array(scenarioRestResponseWithPlatformUrlSchema) (inline, src/transport/scenario.rest.ts:132)
```

#### `GET /:id` · `getApiScenariosById`

Get a specific scenario by ID

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:151`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `POST /` · `postApiScenarios`

Create a new scenario

Permission `scenarios:create`. Declared at `src/transport/scenario.rest.ts:175`.

Answers at `/api/scenarios`, `/api/v1/scenarios`; also, undocumented, `/api/scenarios/2026-08-07`, `/api/v1/scenarios/2026-08-07`, `/api/scenarios/latest`, `/api/v1/scenarios/latest`.

```typescript
type Body = z.infer<typeof scenarioRestCreateSchema>; // ../contract/src/scenario-rest.schemas.ts:154
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `PUT /:id` · `putApiScenariosById`

Update an existing scenario

Permission `scenarios:update`. Declared at `src/transport/scenario.rest.ts:221`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Body = z.infer<typeof scenarioRestUpdateSchema>; // ../contract/src/scenario-rest.schemas.ts:177
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `PATCH /:id` · `patchApiScenariosById`

Update an existing scenario

Permission `scenarios:update`. Declared at `src/transport/scenario.rest.ts:251`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Body = z.infer<typeof scenarioRestUpdateSchema>; // ../contract/src/scenario-rest.schemas.ts:177
type Response = z.infer<typeof scenarioRestResponseWithPlatformUrlSchema>; // ../contract/src/scenario-rest.schemas.ts:70
```

#### `DELETE /:id` · `deleteApiScenariosById`

Archive (soft-delete) a scenario

Permission `scenarios:manage`. Declared at `src/transport/scenario.rest.ts:284`.

Answers at `/api/scenarios/:id`, `/api/v1/scenarios/:id`; also, undocumented, `/api/scenarios/2026-08-07/:id`, `/api/v1/scenarios/2026-08-07/:id`, `/api/scenarios/latest/:id`, `/api/v1/scenarios/latest/:id`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Response = z.infer<typeof scenarioRestArchivedSchema>; // ../contract/src/scenario-rest.schemas.ts:202
```

#### `GET /:id/versions` · `getApiScenariosByIdVersions`

List the saved versions of a scenario, newest first. A scenario saved before versions were recorded closes its history with a synthesized Created entry.

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:300`.

Answers at `/api/scenarios/:id/versions`, `/api/v1/scenarios/:id/versions`; also, undocumented, `/api/scenarios/2026-08-07/:id/versions`, `/api/v1/scenarios/2026-08-07/:id/versions`, `/api/scenarios/latest/:id/versions`, `/api/v1/scenarios/latest/:id/versions`.

```typescript
type Params = z.infer<typeof scenarioRestIdParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:197
type Query = z.infer<typeof scenarioRestListVersionsQuerySchema>; // ../contract/src/scenario-rest.schemas.ts:129
type Response = z.infer<typeof scenarioRestVersionListResponseSchema>; // ../contract/src/scenario-rest.schemas.ts:97
```

#### `GET /:id/versions/:version` · `getApiScenariosByIdVersionsByVersion`

Get one saved version of a scenario, with the name, situation, criteria, labels and parameters as that version saved them.

Permission `scenarios:view`. Declared at `src/transport/scenario.rest.ts:338`.

Answers at `/api/scenarios/:id/versions/:version`, `/api/v1/scenarios/:id/versions/:version`; also, undocumented, `/api/scenarios/2026-08-07/:id/versions/:version`, `/api/v1/scenarios/2026-08-07/:id/versions/:version`, `/api/scenarios/latest/:id/versions/:version`, `/api/v1/scenarios/latest/:id/versions/:version`.

```typescript
type Params = z.infer<typeof scenarioRestIdVersionParamsSchema>; // ../contract/src/scenario-rest.schemas.ts:198
type Response = z.infer<typeof scenarioRestVersionDetailResponseSchema>; // ../contract/src/scenario-rest.schemas.ts:106
```

### `createSimulationRunsRest`

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| Declared at | `src/transport/simulation-run.rest.ts:54`              |
| Base URL    | `/api/simulation-runs`, twin `/api/v1/simulation-runs` |
| Addressing  | dated                                                  |
| Credential  | project                                                |
| Versions    | `2026-08-07`                                           |

#### `GET /` · `getApiSimulationRuns`

List simulation runs, optionally filtered by scenarioSetId or batchRunId. Set-level and unfiltered listings trim each run to its first few messages and report the trim as `messagesTruncated`; pass `include=messages` to read whole conversations, which caps the page at 20 runs, ending on a batch boundary. A batch-scoped listing always carries whole conversations.

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:58`.

Answers at `/api/simulation-runs`, `/api/v1/simulation-runs`; also, undocumented, `/api/simulation-runs/2026-08-07`, `/api/v1/simulation-runs/2026-08-07`, `/api/simulation-runs/latest`, `/api/v1/simulation-runs/latest`.

```typescript
type Query = z.infer<typeof simulationRunListQuerySchema>; // ../contract/src/simulation-run.schemas.ts:112
type Response = z.infer<typeof simulationRunListResponseSchema>; // ../contract/src/simulation-run.schemas.ts:134
```

#### `GET /:scenarioRunId` · `getApiSimulationRunsByScenarioRunId`

Get a single simulation run by its ID

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:77`.

Answers at `/api/simulation-runs/:scenarioRunId`, `/api/v1/simulation-runs/:scenarioRunId`; also, undocumented, `/api/simulation-runs/2026-08-07/:scenarioRunId`, `/api/v1/simulation-runs/2026-08-07/:scenarioRunId`, `/api/simulation-runs/latest/:scenarioRunId`, `/api/v1/simulation-runs/latest/:scenarioRunId`.

```typescript
type Params = z.infer<typeof scenarioRunIdParamsSchema>; // ../contract/src/simulation-run.schemas.ts:131
type Response = z.infer<typeof scenarioRunRestResponseWithPlatformUrlSchema>; // ../contract/src/simulation-run.schemas.ts:79
```

#### `GET /batches/list` · `getApiSimulationRunsBatchesList`

List batch summaries for a scenario set (pass/fail counts per batch)

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:96`.

Answers at `/api/simulation-runs/batches/list`, `/api/v1/simulation-runs/batches/list`; also, undocumented, `/api/simulation-runs/2026-08-07/batches/list`, `/api/v1/simulation-runs/2026-08-07/batches/list`, `/api/simulation-runs/latest/batches/list`, `/api/v1/simulation-runs/latest/batches/list`.

```typescript
type Query = z.infer<typeof simulationBatchQuerySchema>; // ../contract/src/simulation-run.schemas.ts:125
type Response = z.infer<typeof simulationBatchListResponseSchema>; // ../contract/src/simulation-run.schemas.ts:140
```

#### `GET /batches/:batchRunId` · `getApiSimulationRunsBatchesByBatchRunId`

Get the summary of a single batch run, including its completion flag

Permission `scenarios:view`. Declared at `src/transport/simulation-run.rest.ts:122`.

Answers at `/api/simulation-runs/batches/:batchRunId`, `/api/v1/simulation-runs/batches/:batchRunId`; also, undocumented, `/api/simulation-runs/2026-08-07/batches/:batchRunId`, `/api/v1/simulation-runs/2026-08-07/batches/:batchRunId`, `/api/simulation-runs/latest/batches/:batchRunId`, `/api/v1/simulation-runs/latest/batches/:batchRunId`.

```typescript
type Params = z.infer<typeof batchRunIdParamsSchema>; // ../contract/src/simulation-run.schemas.ts:132
type Response = z.infer<typeof simulationBatchSummaryRestSchema>; // ../contract/src/simulation-run.schemas.ts:84
```

## tRPC transport

### `scenarios`

Contract `../contract/src/scenario.trpc.ts:167`, router `src/transport/scenario.trpc.ts:40`.

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

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `scenario_lifecycle` (aggregate `scenario`)

Declared at `src/eventing/scenario-lifecycle.pipeline.ts:30`. Events: `scenarioCreatedEventSchema`.

| Kind    | Name                    | Handles | Declared at                                      |
| ------- | ----------------------- | ------- | ------------------------------------------------ |
| command | `recordScenarioCreated` | –       | `src/eventing/scenario-lifecycle.pipeline.ts:37` |

### Pipeline `simulation_processing` (aggregate `simulation_run`)

Declared at `src/eventing/simulation-processing.pipeline.ts:92`. Events: `SimulationRunQueuedEventSchema`, `SimulationRunStartedEventSchema`, `SimulationMessageSnapshotEventSchema`, `SimulationRunFinishedEventSchema`, `SimulationRunEvaluatedEventSchema`, `SimulationTextMessageStartEventSchema`, `SimulationTextMessageEndEventSchema`, `SimulationRunMetricsComputedEventSchema`, `SimulationRunCancelRequestedEventSchema`, `SimulationRunAgentInstanceRecordedEventSchema`, `SimulationRunCutAtLimitRecordedEventSchema`, `SimulationRunDeletedEventSchema`, `SimulationSetArchivedEventSchema`.

| Kind                       | Name                                                                                    | Handles                                                                                                                                                                                                                                                                                           | Declared at                                          |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:149` |
| command                    | `startRun`                                                                              | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:154` |
| command                    | `messageSnapshot`                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:155` |
| command                    | `textMessageStart`                                                                      | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:156` |
| command                    | `textMessageEnd`                                                                        | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:157` |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:158` |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:163` |
| command                    | `cancelRun`                                                                             | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:168` |
| command                    | `deleteRun`                                                                             | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:169` |
| command                    | `recordAgentInstance`                                                                   | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:170` |
| command                    | `recordCutAtLimit`                                                                      | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:171` |
| command                    | –                                                                                       | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:172` |
| process manager            | `≈ deps.scenarioRunExecution.name`                                                      | ≈ applier `deps.scenarioRunExecution.process`                                                                                                                                                                                                                                                     | `src/eventing/simulation-processing.pipeline.ts:147` |
| process manager            | `≈ deps.scenarioEvaluations.name`                                                       | ≈ applier `deps.scenarioEvaluations.process`                                                                                                                                                                                                                                                      | `src/eventing/simulation-processing.pipeline.ts:148` |
| subscriber                 | `snapshotUpdateBroadcast`                                                               | `lw.simulation_run.queued`, `lw.simulation_run.started`, `lw.simulation_run.message_snapshot`, `lw.simulation_run.text_message_end`, `lw.simulation_run.finished`, `lw.simulation_run.evaluated`, `lw.simulation_run.deleted`, `lw.simulation_run.cancel_requested` from [scenario](../README.md) | `src/eventing/simulation-processing.pipeline.ts:119` |
| subscriber                 | `suiteRunSync`                                                                          | `lw.simulation_run.started`, `lw.simulation_run.finished`, `lw.simulation_run.evaluated` from [scenario](../README.md)                                                                                                                                                                            | `src/eventing/simulation-processing.pipeline.ts:123` |
| subscriber                 | `traceMetricsSync`                                                                      | `lw.simulation_run.finished` from [scenario](../README.md)                                                                                                                                                                                                                                        | `src/eventing/simulation-processing.pipeline.ts:124` |
| peer subscriber            | `traceSpanMetricsSync`                                                                  | `lw.obs.trace.span_received` from [trace](../../trace/README.md)                                                                                                                                                                                                                                  | `src/eventing/simulation-processing.pipeline.ts:128` |
| ClickHouse fold projection | `≈ SimulationRunStateFoldProjection.create({ store: deps.simulationRunStore })`         | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:113` |
| ClickHouse map projection  | `≈ SimulationRunMetricsMapProjection.create({ store: deps.simulationRunMetricsStore })` | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:116` |
| retention                  | `≈ deps.retention`                                                                      | –                                                                                                                                                                                                                                                                                                 | `src/eventing/simulation-processing.pipeline.ts:186` |

### Tasks

Run by the tasks process, before serve.

| Task                    | Class                     | Declared at                                  |
| ----------------------- | ------------------------- | -------------------------------------------- |
| `stalled-runs-backfill` | `StalledRunsBackfillTask` | `src/tasks/stalled-runs-backfill.task.ts:88` |

## Configuration

| Kind   | Leaf                                                  | Environment variable                      | Declared at                              |
| ------ | ----------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| secret | `voiceSessionSigning`                                 | `CREDENTIALS_SECRET`                      | `src/app/scenario.app.ts:263`            |
| secret | `voiceSessionSigningFallback`                         | `NEXTAUTH_SECRET`                         | `src/app/scenario.app.ts:264`            |
| secret | `nlpInternal`                                         | `LANGWATCH_NLP_INTERNAL_SECRET`           | `src/app/scenario.app.ts:266`            |
| config | `langwatchEndpoint`                                   | `LANGWATCH_ENDPOINT`                      | `../contract/src/scenario.config.ts:85`  |
| config | `voicePublicBaseUrl`                                  | `VOICE_PUBLIC_BASE_URL`                   | `../contract/src/scenario.config.ts:87`  |
| config | `voiceTunnel`                                         | `VOICE_TUNNEL`                            | `../contract/src/scenario.config.ts:89`  |
| config | `isSaas`                                              | `IS_SAAS`                                 | `../contract/src/scenario.config.ts:91`  |
| config | `nodeEnvironment`                                     | `NODE_ENV`                                | `../contract/src/scenario.config.ts:93`  |
| config | `voiceWorkerOnly`                                     | `VOICE_WORKER_ONLY`                       | `../contract/src/scenario.config.ts:95`  |
| config | `consumedResourceClasses`                             | `SCENARIO_CONSUMED_RESOURCE_CLASSES`      | `../contract/src/scenario.config.ts:97`  |
| config | `slotBudget`                                          | `SCENARIO_SLOT_BUDGET`                    | `../contract/src/scenario.config.ts:99`  |
| config | `voiceCallMaxSeconds`                                 | `VOICE_CALL_MAX_SECONDS`                  | `../contract/src/scenario.config.ts:101` |
| config | `allowLoopbackVoiceProviders`                         | `VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS`   | `../contract/src/scenario.config.ts:103` |
| config | `blockLocalHttpCalls`                                 | `BLOCK_LOCAL_HTTP_CALLS`                  | `../contract/src/scenario.config.ts:104` |
| config | `allowedProxyHosts`                                   | `ALLOWED_PROXY_HOSTS`                     | `../contract/src/scenario.config.ts:105` |
| config | `defaultModel`                                        | `LANGWATCH_DEFAULT_MODEL`                 | `../contract/src/scenario.config.ts:106` |
| config | `nlpServiceUrl`                                       | `LANGWATCH_NLP_SERVICE`                   | `../contract/src/scenario.config.ts:108` |
| config | `nlpCodeBlockTimeoutSeconds`                          | `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS` | `../contract/src/scenario.config.ts:110` |
| config | `publicBaseUrl`                                       | `BASE_HOST`                               | `../contract/src/scenario.config.ts:112` |
| config | `rawSocketPort`                                       | `VOICE_WS_PORT`                           | `../contract/src/scenario.config.ts:114` |
| config | `nlpTimeouts.maxTimeoutMs`                            | `NLP_FETCH_MAX_TIMEOUT_MS`                | `../contract/src/scenario.config.ts:117` |
| config | `childParentEnvironment.path`                         | `PATH`                                    | `../contract/src/scenario.config.ts:120` |
| config | `childParentEnvironment.home`                         | `HOME`                                    | `../contract/src/scenario.config.ts:121` |
| config | `childParentEnvironment.user`                         | `USER`                                    | `../contract/src/scenario.config.ts:122` |
| config | `childParentEnvironment.shell`                        | `SHELL`                                   | `../contract/src/scenario.config.ts:123` |
| config | `childParentEnvironment.lang`                         | `LANG`                                    | `../contract/src/scenario.config.ts:124` |
| config | `childParentEnvironment.lcAll`                        | `LC_ALL`                                  | `../contract/src/scenario.config.ts:125` |
| config | `childParentEnvironment.term`                         | `TERM`                                    | `../contract/src/scenario.config.ts:126` |
| config | `childParentEnvironment.nodeCompileCache`             | `NODE_COMPILE_CACHE`                      | `../contract/src/scenario.config.ts:127` |
| config | `childParentEnvironment.corepackEnableDownloadPrompt` | `COREPACK_ENABLE_DOWNLOAD_PROMPT`         | `../contract/src/scenario.config.ts:128` |
| config | `childParentEnvironment.nodeExtraCaCerts`             | `NODE_EXTRA_CA_CERTS`                     | `../contract/src/scenario.config.ts:129` |

<!-- readme:generated:end -->
