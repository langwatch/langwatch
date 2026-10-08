# @langwatch/automation-process

The server half of [automation](../README.md). Automations: triggers and their fire history, report schedules, delivery policy and project email suppression, and the pipeline that evaluates and delivers them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("automation").withRepositories(automationRepositories).withChannels(automationChannels).withApi(AutomationModule).withTransports(…, automationTrpcTransport, emailSuppressionTrpcTransport, slackAutomationRest, unsubscribeRest).withTasks(…).withMigrations(…).withEventing(automationsEventing)`, `src/automation.module.ts:34`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AutomationApi`)

Callable automation capability shared by transports and process peers.

Peers call these through the token, declared at `../contract/src/automation.api.ts:71`; nothing else in this package is public.

#### `getAllForProject`

```typescript
getAllForProject(input: { projectId: string }): Promise<Trigger[]>;
```

#### `listAutomations`

Every automation the list renders: redacted, with its monitors and graph.

```typescript
listAutomations(input: { projectId: string }): Promise<AutomationListRow[]>;
```

#### `findById`

```typescript
findById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
```

#### `findRedactedById`

One automation with every secret stripped, for a browser to read.

```typescript
findRedactedById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
```

#### `findLiveById`

```typescript
findLiveById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
```

#### `getById`

```typescript
getById(input: { triggerId: string; projectId: string }): Promise<Trigger>;
```

#### `findByCustomGraphId`

```typescript
findByCustomGraphId(input: { projectId: string; customGraphId: string }): Promise<Trigger | null>;
```

#### `getByCustomGraphIds`

```typescript
getByCustomGraphIds(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]>;
```

#### `assertCustomGraphInProject`

```typescript
assertCustomGraphInProject(input: { customGraphId: string; projectId: string }): Promise<void>;
```

#### `customGraphExistsInProject`

```typescript
customGraphExistsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean>;
```

#### `getCustomGraphNamesByIds`

```typescript
getCustomGraphNamesByIds(input: { customGraphIds: string[]; projectId: string; }): Promise<CustomGraphNameRef[]>;
```

#### `getMonitorsByIds`

```typescript
getMonitorsByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
```

#### `resolvePersistDailyCap`

```typescript
resolvePersistDailyCap(projectId: string): Promise<number>;
```

#### `readPersistCapCounts`

```typescript
readPersistCapCounts(input: { projectId: string; triggerIds: readonly string[]; now: Instant; cap: number; }): Promise<Record<string, AutomationPersistCapCount>>;
```

#### `readDailyCapStatus`

The ceiling and what each automation has spent of it today.

```typescript
readDailyCapStatus(input: { projectId: string }): Promise<AutomationPersistCapStatus>;
```

#### `getFireStats`

```typescript
getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]>;
```

#### `getRecentFires`

```typescript
getRecentFires(input: { projectId: string; triggerId?: string; limit: number; }): Promise<TriggerFire[]>;
```

#### `getRecentWebhookDeliveries`

```typescript
getRecentWebhookDeliveries(input: { projectId: string; triggerId: string; limit: number; }): Promise<WebhookDeliveryRow[]>;
```

#### `getReportSchedules`

```typescript
getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]>;
```

#### `registeredMigrations`

The ORGANIZATION-rooted migrations automation registers (the Slack connection move).

```typescript
registeredMigrations(): readonly SystemMigration[];
```

#### `listSlackChannels`

The Slack conversations a connection's bot can see, for the channel picker.

```typescript
listSlackChannels(input: AutomationApiListSlackChannelsInput): Promise<SlackChannelListing>;
```

#### `create`

```typescript
create(input: CreateTriggerCommand): Promise<Trigger>;
```

#### `createTraceAutomation`

```typescript
createTraceAutomation(input: CreateTriggerCommand): Promise<Trigger>;
```

#### `createAutomation`

The authoring surface's legacy create, with its per-action refusals.

```typescript
createAutomation(input: AutomationApiCreateInput, author: AutomationAuthor): Promise<Trigger>;
```

#### `saveAutomation`

The authoring drawer's save: one row, whichever of the three kinds it is.

```typescript
saveAutomation(input: AutomationApiUpsertInput, author: AutomationAuthor): Promise<Trigger>;
```

#### `setAutomationActive`

Pausing and resuming, including the report's calendar entry.

```typescript
setAutomationActive(input: AutomationApiToggleTriggerInput): Promise<Trigger>;
```

#### `replaceAutomationFilters`

Replaces one automation's condition, keeping it from matching everything.

```typescript
replaceAutomationFilters(input: AutomationApiUpdateTriggerFiltersInput): Promise<Trigger>;
```

#### `update`

```typescript
update(input: UpdateTriggerCommand): Promise<Trigger>;
```

#### `getPublicTrigger`

Main's public-API read: one live automation, redacted; `trigger_not_found` on a miss.

```typescript
getPublicTrigger(input: { projectId: string; triggerId: string }): Promise<Trigger>;
```

#### `createPublicTrigger`

Main's public-API create: held to the dashboard's rules, credentials never read back.

```typescript
createPublicTrigger(input: { projectId: string; actorId: string; input: AutomationRestCreateInput; }): Promise<Trigger>;
```

#### `updatePublicTrigger`

Main's public-API update: channel and kind fixed, a sent-back placeholder keeps the secret.

```typescript
updatePublicTrigger(input: { projectId: string; triggerId: string; actorId: string; input: AutomationRestUpdateInput; }): Promise<Trigger>;
```

#### `setPublicTriggerActive`

Main's public-API pause/resume: `trigger_not_found` on a miss; a resumed report re-syncs.

```typescript
setPublicTriggerActive(input: { projectId: string; triggerId: string; active: boolean; }): Promise<Trigger>;
```

#### `deletePublicTrigger`

Main's public-API delete: `trigger_not_found` on a miss; a report's schedule retires too.

```typescript
deletePublicTrigger(input: { projectId: string; triggerId: string }): Promise<void>;
```

#### `getFireHistory`

One keyset page of an automation's fires, newest first; `trigger_not_found` on a miss.

```typescript
getFireHistory(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage>;
```

#### `listFireHistoryPage`

Main's tRPC view read: the same page, but empty rather than refused on a miss.

```typescript
listFireHistoryPage(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage>;
```

#### `findLatestEvaluation`

The alert's latest recorded check: zero rows when it has never been evaluated.

```typescript
findLatestEvaluation(input: AutomationApiTriggerScope): Promise<TriggerLatestEvaluation[]>;
```

#### `getNextFiring`

When the automation acts next; `trigger_not_found` on a miss.

```typescript
getNextFiring(input: AutomationApiTriggerScope): Promise<NextFiring>;
```

#### `testFireStoredTrigger`

Sends a stored automation's message to its own saved destination, capped per project.

```typescript
testFireStoredTrigger(input: { projectId: string; triggerId: string }): Promise<TestFireResult>;
```

#### `delete`

```typescript
delete(input: { triggerId: string; projectId: string }): Promise<void>;
```

#### `softDeleteById`

Deactivates and soft-deletes one automation in a single write.

```typescript
softDeleteById(input: { triggerId: string; projectId: string }): Promise<Trigger>;
```

#### `syncReportSchedule`

```typescript
syncReportSchedule(input: { projectId: string; triggerId: string; cron: string; timezone: string; }): Promise<void>;
```

#### `removeReportSchedule`

```typescript
removeReportSchedule(input: { projectId: string; triggerId: string }): Promise<void>;
```

#### `findAllReportSchedules`

Every live report's schedule across projects, for the operator scheduler.

```typescript
findAllReportSchedules(): Promise<OperatorReportSchedule[]>;
```

#### `setReportScheduleActive`

An operator's pause or resume of one report's schedule; the automation stays as saved.

```typescript
setReportScheduleActive(input: { projectId: string; triggerId: string; active: boolean; }): Promise<void>;
```

#### `requestReportRun`

An operator's run-now: one extra send, the cadence unchanged.

```typescript
requestReportRun(input: { projectId: string; triggerId: string }): Promise<void>;
```

#### `clearReportRun`

An operator's release of a run held past staleness; only the run it names is released.

```typescript
clearReportRun(input: { projectId: string; triggerId: string; requestId: string }): Promise<void>;
```

#### `invalidate`

```typescript
invalidate(projectId: string): Promise<void>;
```

#### `assertTraceConditionPresent`

```typescript
assertTraceConditionPresent(filters: Record<string, unknown> | undefined): void;
```

#### `assertConditionSurvivesEdit`

```typescript
assertConditionSurvivesEdit(input: { existing: Trigger; filters: Record<string, unknown> | undefined; }): void;
```

#### `validateTemplateDraft`

```typescript
validateTemplateDraft(input: TestFireTemplateDraft): void;
```

#### `getProjectIdentity`

```typescript
getProjectIdentity(projectId: string): Promise<{ name: string; slug: string }>;
```

#### `testFire`

```typescript
testFire(input: TestFireInput): Promise<TestFireResult>;
```

#### `sendTestFire`

The authoring drawer's test-fire button, throttled and self-addressed.

```typescript
sendTestFire(input: AutomationApiTestFireInput, author: AutomationTestFireAuthor): Promise<TestFireResult>;
```

#### `findUnsubscribeView`

```typescript
findUnsubscribeView(input: { token: string; }): Promise<{ projectName: string; triggerName: string | null; email: string } | null>;
```

#### `resolveUnsubscribeView`

The unsubscribe page's own read, throttled per caller (ADR-031).

```typescript
resolveUnsubscribeView(input: { token: string; callerAddress: string | null; }): Promise<UnsubscribeView>;
```

#### `confirmUnsubscribe`

```typescript
confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void>;
```

#### `acceptUnsubscribe`

The same confirmation from either affordance, throttled per caller.

```typescript
acceptUnsubscribe(input: { token: string; scope: "trigger" | "project"; callerAddress: string | null; via: UnsubscribeChannel; }): Promise<void>;
```

#### `listSuppressions`

The operator-facing suppression list, audited because it reads addresses.

```typescript
listSuppressions(input: { projectId: string; actorId: string }): Promise<EmailSuppressionRow[]>;
```

#### `removeSuppression`

```typescript
removeSuppression(input: { id: string; projectId: string }): Promise<void>;
```

#### `getAllEnriched`

Every suppression for a project, each carrying the trigger name it names.

```typescript
getAllEnriched(input: { projectId: string; }): Promise<(EmailSuppression & { triggerName: string | null })[]>;
```

#### `platformUrl`

The platform's own address for one automation resource, built from the project's slug and the path the caller resolved. The REST declaration has no request-scoped builder, so the app composes it.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number; }): Promise<AutomationUsageCount>;
```

## REST transport

### `createAutomationRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/automation.rest.ts:118`   |
| Base URL    | `/api/triggers`, twin `/api/v1/triggers` |
| Addressing  | dated                                    |
| Credential  | project                                  |
| Versions    | `2026-08-07`                             |

#### `GET /` · `getApiTriggers`

List the project's automations, newest first. Paused automations are included.

Permission `triggers:view`. Declared at `src/transport/automation.rest.ts:122`.

Answers at `/api/triggers`, `/api/v1/triggers`; also, undocumented, `/api/triggers/2026-08-07`, `/api/v1/triggers/2026-08-07`, `/api/triggers/latest`, `/api/v1/triggers/latest`.

```typescript
// Response: z.array(automationRestResponseSchema) (inline, src/transport/automation.rest.ts:124)
```

#### `GET /:triggerId` · `getApiTriggersById`

Get a trigger by its ID

Permission `triggers:view`. Declared at `src/transport/automation.rest.ts:139`.

Answers at `/api/triggers/:triggerId`, `/api/v1/triggers/:triggerId`; also, undocumented, `/api/triggers/2026-08-07/:triggerId`, `/api/v1/triggers/2026-08-07/:triggerId`, `/api/triggers/latest/:triggerId`, `/api/v1/triggers/latest/:triggerId`.

```typescript
// Params: automationRestIdParamsSchema, ../contract/src/automation-rest.schemas.ts:261
interface Params {
  triggerId: string;
}
```

#### `GET /:triggerId/fires` · `getApiTriggersByIdFires`

What this automation has done: its fires, newest first. Metadata only (no trace ids and no trace content). Send `nextCursor` back as `cursor` to read the page after this one.

Permission `triggers:view`. Declared at `src/transport/automation.rest.ts:157`.

Answers at `/api/triggers/:triggerId/fires`, `/api/v1/triggers/:triggerId/fires`; also, undocumented, `/api/triggers/2026-08-07/:triggerId/fires`, `/api/v1/triggers/2026-08-07/:triggerId/fires`, `/api/triggers/latest/:triggerId/fires`, `/api/v1/triggers/latest/:triggerId/fires`.

```typescript
type Params = z.infer<typeof automationRestIdParamsSchema>; // ../contract/src/automation-rest.schemas.ts:261
// Query: automationRestFiresQuerySchema, ../contract/src/automation-rest.schemas.ts:392
interface Query {
  limit?: number;
  cursor?: string;
}
```

#### `POST /` · `postApiTriggers`

Create an automation. Send `customGraphId` + `graphAlert` for an alert on a metric, `report` for a scheduled report, or conditions for a trace automation. The delivery channel is fixed at creation.

Permission `triggers:create`. Declared at `src/transport/automation.rest.ts:182`.

Answers at `/api/triggers`, `/api/v1/triggers`; also, undocumented, `/api/triggers/2026-08-07`, `/api/v1/triggers/2026-08-07`, `/api/triggers/latest`, `/api/v1/triggers/latest`.

```typescript
type Body = z.infer<typeof automationRestCreateInputSchema>; // ../contract/src/automation-rest.schemas.ts:289
type Response = z.infer<typeof automationRestResponseSchema>; // ../contract/src/automation-rest.schemas.ts:221
```

#### `PATCH /:triggerId` · `patchApiTriggersById`

Update an automation. Every field is optional and what is left out is left alone, except `actionParams`, which replaces the delivery configuration as a whole. The delivery channel and an alert's graph cannot be changed.

Permission `triggers:update`. Declared at `src/transport/automation.rest.ts:206`.

Answers at `/api/triggers/:triggerId`, `/api/v1/triggers/:triggerId`; also, undocumented, `/api/triggers/2026-08-07/:triggerId`, `/api/v1/triggers/2026-08-07/:triggerId`, `/api/triggers/latest/:triggerId`, `/api/v1/triggers/latest/:triggerId`.

```typescript
type Params = z.infer<typeof automationRestIdParamsSchema>; // ../contract/src/automation-rest.schemas.ts:261
type Body = z.infer<typeof automationRestUpdateInputSchema>; // ../contract/src/automation-rest.schemas.ts:318
```

#### `POST /:triggerId/enable` · `postApiTriggersByIdEnable`

Resume a paused automation. A report goes back on its schedule; the pause record is cleared.

Permission `triggers:update`. Declared at `src/transport/automation.rest.ts:236`.

Answers at `/api/triggers/:triggerId/enable`, `/api/v1/triggers/:triggerId/enable`; also, undocumented, `/api/triggers/2026-08-07/:triggerId/enable`, `/api/v1/triggers/2026-08-07/:triggerId/enable`, `/api/triggers/latest/:triggerId/enable`, `/api/v1/triggers/latest/:triggerId/enable`.

```typescript
type Params = z.infer<typeof automationRestIdParamsSchema>; // ../contract/src/automation-rest.schemas.ts:261
// Body: automationRestNoBodySchema, ../contract/src/automation-rest.schemas.ts:430
type Body = Record<string, unknown>;
```

#### `POST /:triggerId/disable` · `postApiTriggersByIdDisable`

Pause an automation. A report stops claiming its schedule.

Permission `triggers:update`. Declared at `src/transport/automation.rest.ts:260`.

Answers at `/api/triggers/:triggerId/disable`, `/api/v1/triggers/:triggerId/disable`; also, undocumented, `/api/triggers/2026-08-07/:triggerId/disable`, `/api/v1/triggers/2026-08-07/:triggerId/disable`, `/api/triggers/latest/:triggerId/disable`, `/api/v1/triggers/latest/:triggerId/disable`.

```typescript
type Params = z.infer<typeof automationRestIdParamsSchema>; // ../contract/src/automation-rest.schemas.ts:261
type Body = z.infer<typeof automationRestNoBodySchema>; // ../contract/src/automation-rest.schemas.ts:430
```

#### `POST /:triggerId/test-fire` · `postApiTriggersByIdTestFire`

Send this automation's message to the destination it is configured with, so you can confirm it arrives. Nothing is recorded as a fire.

Permission `triggers:update`. Declared at `src/transport/automation.rest.ts:285`.

Answers at `/api/triggers/:triggerId/test-fire`, `/api/v1/triggers/:triggerId/test-fire`; also, undocumented, `/api/triggers/2026-08-07/:triggerId/test-fire`, `/api/v1/triggers/2026-08-07/:triggerId/test-fire`, `/api/triggers/latest/:triggerId/test-fire`, `/api/v1/triggers/latest/:triggerId/test-fire`.

```typescript
type Params = z.infer<typeof automationRestIdParamsSchema>; // ../contract/src/automation-rest.schemas.ts:261
type Body = z.infer<typeof automationRestNoBodySchema>; // ../contract/src/automation-rest.schemas.ts:430
```

#### `DELETE /:triggerId` · `deleteApiTriggersById`

Delete (soft-delete) a trigger

Permission `triggers:manage`. Declared at `src/transport/automation.rest.ts:308`.

Answers at `/api/triggers/:triggerId`, `/api/v1/triggers/:triggerId`; also, undocumented, `/api/triggers/2026-08-07/:triggerId`, `/api/v1/triggers/2026-08-07/:triggerId`, `/api/triggers/latest/:triggerId`, `/api/v1/triggers/latest/:triggerId`.

```typescript
type Params = z.infer<typeof automationRestIdParamsSchema>; // ../contract/src/automation-rest.schemas.ts:261
```

### `slackAutomationRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/slack-trigger.rest.ts:18` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | project                                  |

#### `POST /api/trigger/slack` · `postApiTriggerSlack`

Create a Slack alert trigger

Permission `triggers:manage`. Declared at `src/transport/slack-trigger.rest.ts:23`.

Answers at `/api/trigger/slack`, `/api/v1/trigger/slack`.

```typescript
// Body: slackAutomationRestInputSchema, ../contract/src/automation-rest.schemas.ts:433
interface Body {
  slack_webhook?: string;
  slack_connection_id?: string;
  slack_channel_id?: string;
  name: string;
  message?: string;
  filters?: Record<
    string,
    string[] | Record<string, string[]> | Record<string, Record<string, string[]>>
  >;
  alert_type: "CRITICAL" | "WARNING" | "INFO";
}
// Response: slackAutomationRestCreatedSchema, ../contract/src/automation-rest.schemas.ts:476
interface Response {
  message: string;
}
```

### `unsubscribeRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/unsubscribe.rest.ts:39` |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/unsubscribe` · `confirmOneClickUnsubscribe`

RFC 8058 one-click unsubscribe

Public: RFC 8058 one-click unsubscribe; the HMAC token in ?token= is the authorization, no session. Declared at `src/transport/unsubscribe.rest.ts:44`.

Answers at `/api/unsubscribe`, `/api/v1/unsubscribe`.

```typescript
// Query: unsubscribeQuery, src/transport/unsubscribe.rest.ts:29
interface Query {
  token?: string;
}
// Response: unsubscribeRestAcknowledgedSchema, ../contract/src/automation-rest.schemas.ts:479
interface Response {
  ok: boolean;
}
```

## tRPC transport

### `automation`

Contract `../contract/src/automation.trpc.ts:41`, router `src/transport/automation.trpc.ts:18`.

| Procedure                         | Kind     | Gate                         | Input                                          | Output                           |
| --------------------------------- | -------- | ---------------------------- | ---------------------------------------------- | -------------------------------- |
| `automation.create`               | mutation | Permission `triggers:create` | `automationApiCreateInputSchema`               | `triggerSchema`                  |
| `automation.deleteById`           | mutation | Permission `triggers:delete` | `automationApiTriggerScopeSchema`              | `automationDeletedSchema`        |
| `automation.getTriggers`          | query    | Permission `triggers:view`   | `automationApiProjectScopeSchema`              | inline                           |
| `automation.getDailyCap`          | query    | Permission `triggers:view`   | `automationApiProjectScopeSchema`              | `automationDailyCapSchema`       |
| `automation.getDailyCapStatus`    | query    | Permission `triggers:view`   | `automationApiProjectScopeSchema`              | `automationDailyCapStatusSchema` |
| `automation.getTriggerStats`      | query    | Permission `triggers:view`   | `automationApiProjectScopeSchema`              | inline                           |
| `automation.getRecentFires`       | query    | Permission `triggers:view`   | `automationApiRecentFiresInputSchema`          | inline                           |
| `automation.getWebhookDeliveries` | query    | Permission `triggers:view`   | `automationApiWebhookDeliveriesInputSchema`    | inline                           |
| `automation.getFireHistory`       | query    | Permission `triggers:view`   | `automationApiFireHistoryTrpcInputSchema`      | `triggerFirePageSchema`          |
| `automation.getLatestEvaluation`  | query    | Permission `triggers:view`   | `automationApiTriggerScopeSchema`              | inline                           |
| `automation.getNextFiring`        | query    | Permission `triggers:view`   | `automationApiTriggerScopeSchema`              | `nextFiringSchema`               |
| `automation.getRecentActivity`    | query    | Permission `triggers:view`   | `automationApiRecentActivityInputSchema`       | inline                           |
| `automation.getReportSchedules`   | query    | Permission `triggers:view`   | `automationApiProjectScopeSchema`              | inline                           |
| `automation.toggleTrigger`        | mutation | Permission `triggers:update` | `automationApiToggleTriggerInputSchema`        | `triggerSchema`                  |
| `automation.getTriggerById`       | query    | Permission `triggers:view`   | `automationApiTriggerScopeSchema`              | inline                           |
| `automation.listSlackChannels`    | mutation | Permission `triggers:update` | `automationApiListSlackChannelsInputSchema`    | `slackChannelListingSchema`      |
| `automation.updateTriggerFilters` | mutation | Permission `triggers:update` | `automationApiUpdateTriggerFiltersInputSchema` | `triggerSchema`                  |
| `automation.testFireTemplate`     | mutation | Permission `triggers:update` | `automationApiTestFireInputSchema`             | `testFireResultSchema`           |
| `automation.upsert`               | mutation | Permission `triggers:update` | `automationApiUpsertInputSchema`               | `triggerSchema`                  |

```typescript
// automation.create
type Input = z.infer<typeof automationApiCreateInputSchema>; // ../contract/src/automation.trpc-schemas.ts:92
type Output = z.infer<typeof triggerSchema>; // ../contract/src/trigger.ts:55

// automation.deleteById
// Input: automationApiTriggerScopeSchema, ../contract/src/automation.trpc-schemas.ts:26
interface Input {
  projectId: string;
  triggerId: string;
}
// Output: automationDeletedSchema, ../contract/src/automation.responses.ts:35
interface Output {
  success: boolean;
}

// automation.getTriggers
// Input: automationApiProjectScopeSchema, ../contract/src/automation.trpc-schemas.ts:22
interface Input {
  projectId: string;
}
// Output: automationListRowSchema.array() (inline, ../contract/src/automation.trpc.ts:52)

// automation.getDailyCap
type Input = z.infer<typeof automationApiProjectScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:22
// Output: automationDailyCapSchema, ../contract/src/automation.responses.ts:25
interface Output {
  cap: number;
}

// automation.getDailyCapStatus
type Input = z.infer<typeof automationApiProjectScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:22
// Output: automationDailyCapStatusSchema, ../contract/src/automation.responses.ts:28
interface Output {
  cap: number;
  counts: Record<
    string,
    {
      count: number;
      skipped: number;
    }
  >;
}

// automation.getTriggerStats
type Input = z.infer<typeof automationApiProjectScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:22
// Output: inline, ../contract/src/automation.trpc.ts:69
type Output = {
  triggerId: string;
  lastFiredAt: unknown | null;
  recentFireCount: number;
  currentlyFiring: boolean;
}[];

// automation.getRecentFires
// Input: automationApiRecentFiresInputSchema, ../contract/src/automation.trpc-schemas.ts:124
interface Input {
  projectId: string;
  triggerId: string;
  limit?: number;
}
// Output: inline, ../contract/src/automation.trpc.ts:73
type Output = {
  id: string;
  triggerId: string;
  customGraphId: string | null;
  createdAt: unknown;
  resolvedAt: unknown | null;
}[];

// automation.getWebhookDeliveries
// Input: automationApiWebhookDeliveriesInputSchema, ../contract/src/automation.trpc-schemas.ts:131
interface Input {
  projectId: string;
  triggerId: string;
  limit?: number;
}
// Output: webhookDeliveryRowSchema.array() (inline, ../contract/src/automation.trpc.ts:78)

// automation.getFireHistory
// Input: automationApiFireHistoryTrpcInputSchema, ../contract/src/automation.trpc-schemas.ts:292
interface Input {
  projectId: string;
  triggerId: string;
  limit?: number;
  cursor?: {
    createdAt: unknown;
    id: string;
  } | null;
}
type Output = z.infer<typeof triggerFirePageSchema>; // ../contract/src/automation.trpc-schemas.ts:276

// automation.getLatestEvaluation
type Input = z.infer<typeof automationApiTriggerScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:26
// Output: inline, ../contract/src/automation.trpc.ts:88
type Output = {
  triggerId: string;
  projectId: string;
  evaluatedAt: unknown;
  verdict: string;
  observedValue: number | null;
  threshold: number | null;
  operator: string | null;
  timePeriodMinutes: number | null;
  skipCode: string | null;
} | null;

// automation.getNextFiring
type Input = z.infer<typeof automationApiTriggerScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:26
type Output = z.infer<typeof nextFiringSchema>; // ../contract/src/automation.trpc-schemas.ts:318

// automation.getRecentActivity
// Input: automationApiRecentActivityInputSchema, ../contract/src/automation.trpc-schemas.ts:140
interface Input {
  projectId: string;
  limit?: number;
}
// Output: inline, ../contract/src/automation.trpc.ts:97
type Output = {
  id: string;
  triggerId: string;
  customGraphId: string | null;
  createdAt: unknown;
  resolvedAt: unknown | null;
}[];

// automation.getReportSchedules
type Input = z.infer<typeof automationApiProjectScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:22
// Output: inline, ../contract/src/automation.trpc.ts:105
type Output = {
  triggerId: string;
  nextRunAt: unknown | null;
  lastRunAt: unknown | null;
  active: boolean;
}[];

// automation.toggleTrigger
// Input: automationApiToggleTriggerInputSchema, ../contract/src/automation.trpc-schemas.ts:148
interface Input {
  triggerId: string;
  active: boolean;
  projectId: string;
}
type Output = z.infer<typeof triggerSchema>; // ../contract/src/trigger.ts:55

// automation.getTriggerById
type Input = z.infer<typeof automationApiTriggerScopeSchema>; // ../contract/src/automation.trpc-schemas.ts:26
// Output: triggerSchema.nullable() (inline, ../contract/src/automation.trpc.ts:113)

// automation.listSlackChannels
// Input: automationApiListSlackChannelsInputSchema, ../contract/src/automation.trpc-schemas.ts:156
interface Input {
  projectId: string;
  slackIntegrationId: string;
}
// Output: slackChannelListingSchema, ../contract/src/automation.responses.ts:52
interface Output {
  channels: {
    id: string;
    name: string;
    isPrivate: boolean;
  }[];
  error: string | null;
  gaps: ("page_cap" | "private_channels_hidden")[];
}

// automation.updateTriggerFilters
// Input: automationApiUpdateTriggerFiltersInputSchema, ../contract/src/automation.trpc-schemas.ts:164
interface Input {
  triggerId: string;
  projectId: string;
  filters: Record<
    string,
    string[] | Record<string, string[]> | Record<string, Record<string, string[]>>
  >;
}
type Output = z.infer<typeof triggerSchema>; // ../contract/src/trigger.ts:55

// automation.testFireTemplate
type Input = z.infer<typeof automationApiTestFireInputSchema>; // ../contract/src/automation.trpc-schemas.ts:173
// Output: testFireResultSchema, ../contract/src/test-fire.ts:62
interface Output {
  channel: "email" | "slack" | "webhook";
  recipientCount: number;
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
  httpStatus?: number;
}

// automation.upsert
type Input = z.infer<typeof automationApiUpsertInputSchema>; // ../contract/src/automation.trpc-schemas.ts:244
type Output = z.infer<typeof triggerSchema>; // ../contract/src/trigger.ts:55
```

### `emailSuppression`

Contract `../contract/src/email-suppression.trpc.ts:30`, router `src/transport/email-suppression.trpc.ts:22`.

| Procedure                                  | Kind     | Gate                                                                                                                                                                            | Input                           | Output                               |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| `emailSuppression.resolveUnsubscribeToken` | query    | Public: the unsubscribe link arrives in a mail client where no session exists; the single-purpose token in it, whose HMAC binds it to one recipient, is the whole authorization | `resolveUnsubscribeInputSchema` | `unsubscribeViewSchema`              |
| `emailSuppression.confirmUnsubscribe`      | mutation | Public: the unsubscribe link arrives in a mail client where no session exists; the single-purpose token in it, whose HMAC binds it to one recipient, is the whole authorization | `confirmUnsubscribeInputSchema` | `emailSuppressionAcknowledgedSchema` |
| `emailSuppression.getAll`                  | query    | Permission `triggers:view`                                                                                                                                                      | `suppressionProjectScopeSchema` | inline                               |
| `emailSuppression.remove`                  | mutation | Permission `triggers:manage`                                                                                                                                                    | `removeSuppressionInputSchema`  | `emailSuppressionAcknowledgedSchema` |

```typescript
// emailSuppression.resolveUnsubscribeToken
// Input: resolveUnsubscribeInputSchema, ../contract/src/email-suppression.trpc.ts:16
interface Input {
  token: string;
}
// Output: unsubscribeViewSchema, ../contract/src/automation.ts:38
interface Output {
  projectName: string;
  triggerName: string | null;
  email: string;
}

// emailSuppression.confirmUnsubscribe
// Input: confirmUnsubscribeInputSchema, ../contract/src/email-suppression.trpc.ts:19
interface Input {
  token: string;
  scope: "trigger" | "project";
}
// Output: emailSuppressionAcknowledgedSchema, ../contract/src/automation.ts:56
interface Output {
  ok: boolean;
}

// emailSuppression.getAll
// Input: suppressionProjectScopeSchema, ../contract/src/email-suppression.trpc.ts:25
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/email-suppression.trpc.ts:41
type Output = {
  id: string;
  email: string;
  triggerId: string | null;
  reason: string;
  createdAt: unknown;
  triggerName: string | null;
}[];

// emailSuppression.remove
// Input: removeSuppressionInputSchema, ../contract/src/email-suppression.trpc.ts:28
interface Input {
  projectId: string;
  id: string;
}
type Output = z.infer<typeof emailSuppressionAcknowledgedSchema>; // ../contract/src/automation.ts:56
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `automations` (aggregate `trigger`)

Declared at `src/eventing/automation.pipeline.ts:182`. Events: `triggerMatchRecordedEventSchema`, `...reportScheduleEventSchemas`.

| Kind            | Name                               | Handles                                                                                                                                       | Declared at                               |
| --------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| command         | `recordTriggerMatch`               | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:189` |
| command         | `configureReportSchedule`          | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:196` |
| command         | `pauseReportSchedule`              | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:197` |
| command         | `resumeReportSchedule`             | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:198` |
| command         | `requestReportRun`                 | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:199` |
| command         | `settleReportRun`                  | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:200` |
| process manager | `triggerSettlement`                | intents `logOverflow`, `persistMatch`, `notifyDigest`, `persistMatch`, `notifyDigest`, `logOverflow`, `notifyDigest`, `persistMatch` (outbox) | `src/eventing/automation.pipeline.ts:201` |
| process manager | `reportSchedule`                   | intents `dispatchReport` (outbox)                                                                                                             | `src/eventing/automation.pipeline.ts:299` |
| process manager | `automationAudit`                  | every 1 d (`AUTOMATION_AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneAudit`, `recordAudit` (outbox)                          | `src/eventing/automation.pipeline.ts:315` |
| process manager | `graphAlertSweep`                  | every 30 s (`GRAPH_ALERT_SWEEP_INTERVAL_MS`); intents `evaluateGraph`                                                                         | `src/eventing/automation.pipeline.ts:332` |
| peer subscriber | `traceSpanTriggerMatch`            | `lw.obs.trace.span_received` from [trace](../../trace/README.md)                                                                              | `src/eventing/automation.pipeline.ts:343` |
| peer subscriber | `traceOriginTriggerMatch`          | `lw.obs.trace.origin_resolved` from [trace](../../trace/README.md)                                                                            | `src/eventing/automation.pipeline.ts:360` |
| peer subscriber | `evaluationCompletedTriggerMatch`  | `lw.evaluation.completed` from [evaluation](../../evaluation/README.md)                                                                       | `src/eventing/automation.pipeline.ts:376` |
| peer subscriber | `evaluationReportedTriggerMatch`   | `lw.evaluation.reported` from [evaluation](../../evaluation/README.md)                                                                        | `src/eventing/automation.pipeline.ts:392` |
| peer subscriber | `traceSpanGraphActivity`           | `lw.obs.trace.span_received` from [trace](../../trace/README.md)                                                                              | `src/eventing/automation.pipeline.ts:409` |
| peer subscriber | `traceOriginGraphActivity`         | `lw.obs.trace.origin_resolved` from [trace](../../trace/README.md)                                                                            | `src/eventing/automation.pipeline.ts:419` |
| peer subscriber | `evaluationCompletedGraphActivity` | `lw.evaluation.completed` from [evaluation](../../evaluation/README.md)                                                                       | `src/eventing/automation.pipeline.ts:429` |
| peer subscriber | `evaluationReportedGraphActivity`  | `lw.evaluation.reported` from [evaluation](../../evaluation/README.md)                                                                        | `src/eventing/automation.pipeline.ts:439` |
| lane aliases    | `≈ MAIN_TRIGGER_LANE_ALIASES`      | –                                                                                                                                             | `src/eventing/automation.pipeline.ts:449` |

### Tasks

Run by the tasks process, before serve.

| Task                       | Class                        | Declared at                                     |
| -------------------------- | ---------------------------- | ----------------------------------------------- |
| `slack-alert`              | `SlackAlertTask`             | `src/tasks/slack-alert.task.ts:9`               |
| `report-schedule-backfill` | `ReportScheduleBackfillTask` | `src/tasks/report-schedule-backfill.task.ts:12` |

## Configuration

| Kind   | Leaf                        | Environment variable                   | Declared at                               |
| ------ | --------------------------- | -------------------------------------- | ----------------------------------------- |
| secret | `unsubscribe`               | `NEXTAUTH_SECRET`                      | `src/app/automation.app.ts:398`           |
| config | `emailHourlyCap`            | `TRIGGER_EMAIL_HOURLY_CAP`             | `../contract/src/automation.config.ts:11` |
| config | `tenantDailyCap`            | `TRIGGER_EMAIL_TENANT_DAILY_CAP`       | `../contract/src/automation.config.ts:12` |
| config | `persistDailyCapFree`       | `TRIGGER_PERSIST_DAILY_CAP_FREE`       | `../contract/src/automation.config.ts:13` |
| config | `persistDailyCapPaid`       | `TRIGGER_PERSIST_DAILY_CAP_PAID`       | `../contract/src/automation.config.ts:14` |
| config | `persistDailyCapEnterprise` | `TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE` | `../contract/src/automation.config.ts:15` |
| config | `publicBaseUrl`             | `BASE_HOST`                            | `../contract/src/automation.config.ts:20` |

<!-- readme:generated:end -->
