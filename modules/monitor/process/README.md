# @langwatch/monitor-process

The server half of [monitor](../README.md). Monitors: the checks that run an evaluator over incoming traces, their definitions and whether one may run.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("monitor").withRepositories(monitorRepositories).withApi(MonitorModule).withTransports(…, monitorTrpcTransport).withEventing(monitorEvaluatorCleanupEventing)`, `src/monitor.module.ts:9`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`MonitorApi`)

Peers call these through the token, declared at `../contract/src/monitor.api.ts:33`; nothing else in this package is public.

#### `list`

Every monitor configured on the project, with its evaluator.

```typescript
list(input: { projectId: string }): Promise<MonitorWithEvaluator[]>;
```

#### `getById`

One monitor. Throws `MonitorNotFoundError` when the project has none.

```typescript
getById(input: MonitorIdInput): Promise<MonitorWithEvaluator>;
```

#### `findById`

One monitor, or `undefined` when the project has none.

```typescript
findById(input: MonitorIdInput): Promise<MonitorWithEvaluator | undefined>;
```

#### `findBySlug`

The project's monitor carrying this slug, or none.

```typescript
findBySlug(input: { projectId: string; slug: string }): Promise<MonitorWithEvaluator[]>;
```

#### `findByEvaluator`

The project's monitors that run one evaluator, by id and name.

```typescript
findByEvaluator(input: { projectId: string; evaluatorId: string; }): Promise<{ id: string; name: string }[]>;
```

#### `isNameAvailable`

```typescript
isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }>;
```

#### `assertCheckRunnable`

Refuses by name when this check cannot run; answers nothing when it can.

```typescript
assertCheckRunnable(input: MonitorRunnableCheckInput): Promise<void>;
```

#### `create`

```typescript
create(input: MonitorCreateInput): Promise<Monitor>;
```

#### `update`

```typescript
update(input: MonitorUpdateInput): Promise<Monitor>;
```

#### `patch`

Applies a partial change, keeping every field the caller did not mention.

```typescript
patch(input: MonitorPatchInput): Promise<Monitor>;
```

#### `upsertForExperiment`

```typescript
upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor>;
```

#### `toggle`

```typescript
toggle(input: MonitorToggleInput): Promise<{ success: true }>;
```

#### `delete`

```typescript
delete(input: MonitorIdInput): Promise<{ success: true }>;
```

#### `getEnabledOnMessageMonitors`

```typescript
getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
```

#### `listEnabledGuardrailMonitors`

```typescript
listEnabledGuardrailMonitors(input: MonitorEnabledGuardrailInput): Promise<EnabledGuardrailMonitor[]>;
```

#### `getAllByIds`

```typescript
getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
```

#### `deleteForExperiment`

```typescript
deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void>;
```

#### `copy`

Copies the configuration into another project, evaluator and all.

```typescript
copy(input: MonitorCopyInput): Promise<Monitor>;
```

#### `replicate`

The copy itself, once the evaluator (if any) already exists in the target.

```typescript
replicate(input: MonitorReplicationInput): Promise<Monitor>;
```

#### `performanceForProject`

The last seven days of score and pass rate for each of the project's monitors.

```typescript
performanceForProject(input: MonitorPerformanceInput): Promise<OnlineEvaluationPerformance[]>;
```

#### `platformUrl`

The platform address for a monitor resource.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<MonitorUsageCount>;
```

## REST transport

### `createMonitorsRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/monitor.rest.ts:68`       |
| Base URL    | `/api/monitors`, twin `/api/v1/monitors` |
| Addressing  | dated                                    |
| Credential  | project                                  |
| Versions    | `2026-08-07`                             |

#### `GET /` · `getApiMonitors`

List all online evaluation monitors for the project

Permission `evaluations:view`. Declared at `src/transport/monitor.rest.ts:72`.

Answers at `/api/monitors`, `/api/v1/monitors`; also, undocumented, `/api/monitors/2026-08-07`, `/api/v1/monitors/2026-08-07`, `/api/monitors/latest`, `/api/v1/monitors/latest`.

```typescript
// Response: z.array(monitorRestResponseSchema) (inline, src/transport/monitor.rest.ts:74)
```

#### `GET /:id` · `getApiMonitorsById`

Get a monitor by its ID

Permission `evaluations:view`. Declared at `src/transport/monitor.rest.ts:86`.

Answers at `/api/monitors/:id`, `/api/v1/monitors/:id`; also, undocumented, `/api/monitors/2026-08-07/:id`, `/api/v1/monitors/2026-08-07/:id`, `/api/monitors/latest/:id`, `/api/v1/monitors/latest/:id`.

```typescript
type Params = z.infer<typeof monitorRestIdParamsSchema>; // ../contract/src/monitor-rest.schemas.ts:6
type Response = z.infer<typeof monitorRestResponseSchema>; // ../contract/src/monitor-rest.schemas.ts:22
```

#### `POST /` · `postApiMonitors`

Create a new online evaluation monitor

Permission `evaluations:create`. Declared at `src/transport/monitor.rest.ts:108`.

Answers at `/api/monitors`, `/api/v1/monitors`; also, undocumented, `/api/monitors/2026-08-07`, `/api/v1/monitors/2026-08-07`, `/api/monitors/latest`, `/api/v1/monitors/latest`.

```typescript
type Body = z.infer<typeof monitorRestCreateInputSchema>; // ../contract/src/monitor-rest.schemas.ts:42
type Response = z.infer<typeof monitorRestResponseSchema>; // ../contract/src/monitor-rest.schemas.ts:22
```

#### `PATCH /:id` · `patchApiMonitorsById`

Update a monitor (name, enabled state, settings, etc.)

Permission `evaluations:update`. Declared at `src/transport/monitor.rest.ts:140`.

Answers at `/api/monitors/:id`, `/api/v1/monitors/:id`; also, undocumented, `/api/monitors/2026-08-07/:id`, `/api/v1/monitors/2026-08-07/:id`, `/api/monitors/latest/:id`, `/api/v1/monitors/latest/:id`.

```typescript
type Params = z.infer<typeof monitorRestIdParamsSchema>; // ../contract/src/monitor-rest.schemas.ts:6
type Body = z.infer<typeof monitorRestUpdateInputSchema>; // ../contract/src/monitor-rest.schemas.ts:55
type Response = z.infer<typeof monitorRestResponseSchema>; // ../contract/src/monitor-rest.schemas.ts:22
```

#### `POST /:id/toggle` · `postApiMonitorsByIdToggle`

Enable or disable a monitor

Permission `evaluations:update`. Declared at `src/transport/monitor.rest.ts:162`.

Answers at `/api/monitors/:id/toggle`, `/api/v1/monitors/:id/toggle`; also, undocumented, `/api/monitors/2026-08-07/:id/toggle`, `/api/v1/monitors/2026-08-07/:id/toggle`, `/api/monitors/latest/:id/toggle`, `/api/v1/monitors/latest/:id/toggle`.

```typescript
type Params = z.infer<typeof monitorRestIdParamsSchema>; // ../contract/src/monitor-rest.schemas.ts:6
type Body = z.infer<typeof monitorRestToggleInputSchema>; // ../contract/src/monitor-rest.schemas.ts:69
type Response = z.infer<typeof monitorRestToggledSchema>; // ../contract/src/monitor-rest.schemas.ts:70
```

#### `DELETE /:id` · `deleteApiMonitorsById`

Delete a monitor

Permission `evaluations:manage`. Declared at `src/transport/monitor.rest.ts:179`.

Answers at `/api/monitors/:id`, `/api/v1/monitors/:id`; also, undocumented, `/api/monitors/2026-08-07/:id`, `/api/v1/monitors/2026-08-07/:id`, `/api/monitors/latest/:id`, `/api/v1/monitors/latest/:id`.

```typescript
type Params = z.infer<typeof monitorRestIdParamsSchema>; // ../contract/src/monitor-rest.schemas.ts:6
type Response = z.infer<typeof monitorRestDeletedSchema>; // ../contract/src/monitor-rest.schemas.ts:71
```

## tRPC transport

### `monitors`

Contract `../contract/src/monitor.trpc.ts:22`, router `src/transport/monitor.trpc.ts:8`.

| Procedure                           | Kind     | Gate                                            | Input                                   | Output                           |
| ----------------------------------- | -------- | ----------------------------------------------- | --------------------------------------- | -------------------------------- |
| `monitors.getAllForProject`         | query    | Permission `evaluations:view`                   | `monitorApiProjectInputSchema`          | inline                           |
| `monitors.getPerformanceForProject` | query    | Permission `evaluations:view or analytics:view` | `monitorApiPerformanceInputSchema`      | inline                           |
| `monitors.getById`                  | query    | Permission `evaluations:view`                   | `monitorApiMonitorInputSchema`          | `monitorWithEvaluatorSchema`     |
| `monitors.isNameAvailable`          | mutation | Permission `evaluations:view`                   | `monitorApiNameAvailabilityInputSchema` | `monitorNameAvailabilitySchema`  |
| `monitors.create`                   | mutation | Permission `evaluations:create`                 | `monitorApiCreateInputSchema`           | `monitorSchema`                  |
| `monitors.update`                   | mutation | Permission `evaluations:update`                 | `monitorApiUpdateInputSchema`           | `monitorSchema`                  |
| `monitors.toggle`                   | mutation | Permission `evaluations:update`                 | `monitorApiToggleInputSchema`           | `monitorWriteAcknowledgedSchema` |
| `monitors.delete`                   | mutation | Permission `evaluations:delete`                 | `monitorApiMonitorInputSchema`          | `monitorWriteAcknowledgedSchema` |
| `monitors.copy`                     | mutation | Permission `evaluations:manage`                 | `monitorApiCopyInputSchema`             | `monitorSchema`                  |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `monitor_evaluator_cleanup` (aggregate `global`)

Declared at `src/eventing/monitor-evaluator-cleanup.pipeline.ts:33`.

| Kind            | Name                      | Handles                                                            | Declared at                                             |
| --------------- | ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| peer subscriber | `monitorEvaluatorDeleted` | `lw.evaluator.deleted` from [evaluator](../../evaluator/README.md) | `src/eventing/monitor-evaluator-cleanup.pipeline.ts:40` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                           |
| ------ | --------------- | -------------------- | ------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/monitor.config.ts:5` |

<!-- readme:generated:end -->
