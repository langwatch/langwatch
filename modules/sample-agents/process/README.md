# @langwatch/sample-agents-process

The server half of [sample-agents](../README.md). The demo agents a caller runs to see its own project fill with traces.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("sample-agents").withApi(SampleAgentsModule).withTransports(hotelBotRest)`, `src/sample-agents.module.ts:7`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SampleAgentsApi`)

The demo agents a caller runs to see its own project fill with traces.

Peers call these through the token, declared at `../contract/src/sample-agents.api.ts:6`; nothing else in this package is public.

#### `runHotelBot`

```typescript
runHotelBot(input: HotelBotRunInput): Promise<HotelBotReply>;
```

## REST transport

### `hotelBotRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/hotel-bot.rest.ts:14`   |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/demo/hotel_bot` · `runHotelBot`

Platform permission `ops:manage`. Credential `browser`. Hidden from the OpenAPI document. Declared at `src/transport/hotel-bot.rest.ts:19`.

Answers at `/api/demo/hotel_bot`.

```typescript
// Body: hotelBotRequestSchema, ../contract/src/sample-agents.api.ts:13
type Body = Record<string, unknown>;
type Headers = z.infer<typeof hotelBotHeadersSchema>; // ../contract/src/sample-agents.api.ts:16
// Response: hotelBotReplySchema, ../contract/src/sample-agents.api.ts:27
interface Response {
  message: "Sent to LangWatch";
  ragResponse?: string | null;
}
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: sample-agents declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                                 |
| ------ | --------------- | -------------------- | ------------------------------------------- |
| secret | `openAi`        | `OPENAI_API_KEY`     | `src/app/sample-agents.app.ts:30`           |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/sample-agents.config.ts:5` |

<!-- readme:generated:end -->
