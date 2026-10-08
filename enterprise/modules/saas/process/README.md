# @langwatch/enterprise-saas-process

The server half of [saas](../README.md). LangWatch Cloud's own surface.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("saas").withRepositories(saasRepositories).withApi(SaasModule).withTransports(usageReportRest)`, `src/saas.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SaasApi`)

LangWatch Cloud's own surface. Every operation refuses on any other deployment.

Peers call these through the token, declared at `../contract/src/saas.api.ts:32`; nothing else in this package is public.

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
// Response: usageReportReceiptSchema, ../contract/src/saas.api.ts:21
interface Response {
  message: "Event captured";
}
```

#### `POST /api/connect/v1/stats` · `receiveConnectUsageReport`

Public: anonymous product telemetry: a self-hosted install presents no credential. Hidden from the OpenAPI document. Declared at `src/transport/usage-report.rest.ts:37`.

Answers at `/api/connect/v1/stats`.

```typescript
type Body = z.infer<typeof usageReportRequestSchema>; // ../contract/src/saas.api.ts:7
type Headers = z.infer<typeof senderAddressHeadersSchema>; // ../contract/src/saas.api.ts:13
type Response = z.infer<typeof usageReportReceiptSchema>; // ../contract/src/saas.api.ts:21
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: saas declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf     | Environment variable | Declared at                        |
| ------ | -------- | -------------------- | ---------------------------------- |
| config | `isSaas` | `IS_SAAS`            | `../contract/src/saas.config.ts:4` |

<!-- readme:generated:end -->
