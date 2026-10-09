# @langwatch/hosted-mcp-process

The server half of [hosted-mcp](../README.md). The hosted MCP server, and the MCP OAuth flow that admits its clients.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("hosted-mcp").withRepositories(hostedMcpRepositories).withApi(HostedMcpModule).withTransports(mcpAuthorizeRest, mcpEndpointDoor)`, `src/hosted-mcp.module.ts:13`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`HostedMcpApiContract`)

The callable Hosted MCP capability exposed to process transports.

Peers call these through the token, declared at `../contract/src/mcp-authorize.schemas.ts:59`; nothing else in this package is public.

#### `createHandler`

```typescript
createHandler(): HostedMcpHandler;
```

## REST transport

### `mcpAuthorizeRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/mcp-authorize.rest.ts:32` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | browser                                  |

#### `POST /api/mcp/authorize` · `approveMcpAuthorization`

Optional credential: the browser door resolves the consent page session; OAuth approval preserves its own 401; no API credential opens this door. Declared at `src/transport/mcp-authorize.rest.ts:38`.

Answers at `/api/mcp/authorize`.

```typescript
// Rawbody: "text" (inline, src/transport/mcp-authorize.rest.ts:43)
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: hosted-mcp declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                              |
| ------ | --------------- | -------------------- | ---------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/hosted-mcp.config.ts:5` |

<!-- readme:generated:end -->
