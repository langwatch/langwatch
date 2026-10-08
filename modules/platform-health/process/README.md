# @langwatch/platform-health-process

The server half of [platform-health](../README.md). Platform health: checks of the services a deployment depends on, all at once or one at a time.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("platform-health").withChannels(platformHealthChannels).withApi(PlatformHealthModule).withTransports(platformHealthRest, platformHealthProbeRest, platformHealthLangyProbeRest).withTransportFacts(…)`, `src/platform-health.module.ts:12`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`PlatformHealthApi`)

Peers call these through the token, declared at `../contract/src/platform-health.ts:94`; nothing else in this package is public.

#### `checkAll`

```typescript
checkAll(query: PlatformHealthCheckInput): Promise<PlatformHealthReport>;
```

#### `checkOne`

```typescript
checkOne(name: PlatformHealthCheckName, query: PlatformHealthCheckInput): Promise<PlatformHealthReport>;
```

## REST transport

### `platformHealthProbeRest`

|             |                                                  |
| ----------- | ------------------------------------------------ |
| Declared at | `src/transport/platform-health-probe.rest.ts:34` |
| Base URL    | none: each route's path is its address           |
| Addressing  | literal                                          |
| Credential  | project                                          |

#### `GET /api/health/collector` · `probeCollectorHealth`

Public: a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:39`.

Answers at `/api/health/collector`.

```typescript
type Headers = z.infer<typeof healthProbeHeadersSchema>; // ../contract/src/platform-health.ts:66
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:42)
```

#### `GET /api/health/evaluations` · `probeEvaluationsHealth`

Public: a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:48`.

Answers at `/api/health/evaluations`.

```typescript
type Headers = z.infer<typeof healthProbeHeadersSchema>; // ../contract/src/platform-health.ts:66
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:51)
```

#### `GET /api/health/processor` · `probeProcessorHealth`

Public: a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:57`.

Answers at `/api/health/processor`.

```typescript
type Headers = z.infer<typeof healthProbeHeadersSchema>; // ../contract/src/platform-health.ts:66
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:60)
```

#### `GET /api/health/triggers` · `probeTriggersHealth`

Public: a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:66`.

Answers at `/api/health/triggers`.

```typescript
type Query = z.infer<typeof platformHealthQuerySchema>; // ../contract/src/platform-health.ts:58
type Headers = z.infer<typeof healthProbeHeadersSchema>; // ../contract/src/platform-health.ts:66
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:70)
```

#### `GET /api/health/workflows` · `probeWorkflowsHealth`

Public: a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:83`.

Answers at `/api/health/workflows`.

```typescript
type Query = z.infer<typeof platformHealthQuerySchema>; // ../contract/src/platform-health.ts:58
type Headers = z.infer<typeof healthProbeHeadersSchema>; // ../contract/src/platform-health.ts:66
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:87)
```

#### `GET /api/health/scenarios` · `probeScenariosHealth`

Public: a project key presented as X-Auth-Token or Authorization: Bearer is resolved by the probe itself, as main's did, and forwarded to the canaries it runs. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:100`.

Answers at `/api/health/scenarios`.

```typescript
type Query = z.infer<typeof scenarioCanaryQuerySchema>; // ../contract/src/platform-health.ts:75
type Headers = z.infer<typeof healthProbeHeadersSchema>; // ../contract/src/platform-health.ts:66
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:104)
```

### `platformHealthLangyProbeRest`

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Declared at | `src/transport/platform-health-probe.rest.ts:120` |
| Base URL    | none: each route's path is its address            |
| Addressing  | literal                                           |
| Credential  | project                                           |

#### `GET /api/health/langy` · `probeLangyHealth`

Permission `langy:create`. Hidden from the OpenAPI document. Declared at `src/transport/platform-health-probe.rest.ts:126`.

Answers at `/api/health/langy`.

```typescript
// Response: "forwarded" (inline, src/transport/platform-health-probe.rest.ts:128)
```

### `platformHealthRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/platform-health.rest.ts:29` |
| Base URL    | `/api/v1/platform-health`                  |
| Addressing  | v1-only                                    |
| Credential  | project                                    |

#### `GET /` · `getPlatformHealth`

Report whether the platform is working

Authenticated: PLATFORM_HEALTH_API_KEY is the bearer this door compares in constant time; a monitor is not a tenant, so no permission is asked. Where the key is unset the door answers 404, as though the family were not there. Credential `internal_secret`. Declared at `src/transport/platform-health.rest.ts:37`.

Answers at `/api/v1/platform-health`.

```typescript
type Query = z.infer<typeof platformHealthQuerySchema>; // ../contract/src/platform-health.ts:58
type Response = z.infer<typeof platformHealthReportSchema>; // ../contract/src/platform-health.ts:49
```

#### `GET /:check` · `getPlatformHealthSubsystem`

Report whether one subsystem is working

Authenticated: PLATFORM_HEALTH_API_KEY is the bearer this door compares in constant time; a monitor is not a tenant, so no permission is asked. Where the key is unset the door answers 404, as though the family were not there. Credential `internal_secret`. Declared at `src/transport/platform-health.rest.ts:49`.

Answers at `/api/v1/platform-health/:check`.

```typescript
// Params: z.object({ check: z.string() }) (inline, src/transport/platform-health.rest.ts:50)
type Query = z.infer<typeof platformHealthQuerySchema>; // ../contract/src/platform-health.ts:58
type Response = z.infer<typeof platformHealthReportSchema>; // ../contract/src/platform-health.ts:49
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: platform-health declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf            | Environment variable            | Declared at                                   |
| ------ | --------------- | ------------------------------- | --------------------------------------------- |
| secret | `probeApiKey`   | `PLATFORM_HEALTH_PROBE_API_KEY` | `src/app/platform-health.app.ts:63`           |
| secret | `apiKey`        | `PLATFORM_HEALTH_API_KEY`       | `src/app/platform-health.app.ts:64`           |
| config | `publicBaseUrl` | `BASE_HOST`                     | `../contract/src/platform-health.config.ts:4` |

<!-- readme:generated:end -->
