# @langwatch/enterprise-demo-data-process

The server half of [demo-data](../README.md). The demo instance's seeding: one run over an allowlisted demo organisation.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("demo-data").withApi(DemoDataModule).withEventing(demoDataEventing).withTasks(…)`, `src/demo-data.module.ts:13`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DemoDataApi`)

The demo instance's seeding: one run over an allowlisted demo organization.

Peers call these through the token, declared at `../contract/src/demo-data-report.ts:36`; nothing else in this package is public.

#### `runSeedDemo`

```typescript
runSeedDemo(input: DemoDataRunInput): Promise<SeedRunReport>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `seed_demo` (aggregate `global`)

Declared at `src/eventing/demo-data.pipeline.ts:28`.

| Kind            | Name          | Handles                                                                           | Declared at                             |
| --------------- | ------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| process manager | `seedDemoRun` | every 1 d (`DEMO_DATA_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `run` (outbox) | `src/eventing/demo-data.pipeline.ts:33` |

### Tasks

Run by the tasks process, before serve.

| Task        | Class          | Declared at                     |
| ----------- | -------------- | ------------------------------- |
| `demo-data` | `DemoDataTask` | `src/tasks/demo-data.task.ts:9` |

## Configuration

| Kind   | Leaf         | Environment variable | Declared at                             |
| ------ | ------------ | -------------------- | --------------------------------------- |
| config | `demoOrgIds` | `DEMO_ORG_IDS`       | `../contract/src/demo-data.config.ts:9` |

<!-- readme:generated:end -->
