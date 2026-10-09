# @langwatch/enterprise-saas-process

The server half of [saas](../README.md). LangWatch Cloud's own surface.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("saas").withRepositories(saasRepositories).withChannels(saasChannels).withApi(SaasModule).withTransports(usageReportRest)`, `src/saas.module.ts:11`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SaasApi`)

LangWatch Cloud's own surface. Every operation refuses on any other deployment.

Peers call these through the token, declared at `../contract/src/saas.api.ts:42`; nothing else in this package is public.

#### `receiveUsageReport`

```typescript
receiveUsageReport(input: IncomingUsageReportRequest): Promise<UsageReportReceipt>;
```

## REST transport

### `usageReportRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/usage-report.rest.ts:21` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/track_usage` · `receiveUsageReport`

Public: anonymous product telemetry: a self-hosted install presents no credential. Hidden from the OpenAPI document. Declared at `src/transport/usage-report.rest.ts:26`.

Answers at `/api/track_usage`.

```typescript
type Body = z.infer<typeof usageReportRequestSchema>; // ../contract/src/saas.api.ts:7
type Headers = z.infer<typeof senderAddressHeadersSchema>; // ../contract/src/saas.api.ts:13
// Response: usageReportReceiptSchema, ../contract/src/saas.api.ts:27
interface Response {
  message: "Event captured";
  latest_release?: {
    release: string;
    commit: string | null;
  };
  floor?: string;
}
```

#### `POST /api/connect/v1/stats` · `receiveConnectUsageReport`

Public: anonymous product telemetry: a self-hosted install presents no credential. Hidden from the OpenAPI document. Declared at `src/transport/usage-report.rest.ts:37`.

Answers at `/api/connect/v1/stats`.

```typescript
type Body = z.infer<typeof usageReportRequestSchema>; // ../contract/src/saas.api.ts:7
type Headers = z.infer<typeof senderAddressHeadersSchema>; // ../contract/src/saas.api.ts:13
type Response = z.infer<typeof usageReportReceiptSchema>; // ../contract/src/saas.api.ts:27
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: saas declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf                  | Environment variable              | Declared at                         |
| ------ | --------------------- | --------------------------------- | ----------------------------------- |
| config | `isSaas`              | `IS_SAAS`                         | `../contract/src/saas.config.ts:18` |
| config | `latestRelease`       | `LANGWATCH_LATEST_RELEASE`        | `../contract/src/saas.config.ts:20` |
| config | `latestReleaseCommit` | `LANGWATCH_LATEST_RELEASE_COMMIT` | `../contract/src/saas.config.ts:22` |
| config | `releaseFloor`        | `LANGWATCH_RELEASE_FLOOR`         | `../contract/src/saas.config.ts:24` |

<!-- readme:generated:end -->
