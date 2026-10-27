# sample-agents

The demo agents a caller runs to see its own project fill with traces.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                           |
| Subjects       | sample-agents                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md)                                                                       |
| Api token      | `SampleAgentsApi` = `moduleApi<SampleAgentsApi>()("sample-agents")`, `contract/src/sample-agents.api.ts:10` (1 operation) |
| Installed by   | api, worker, tasks (process)                                                                                              |

## What sample-agents owns

| Kind            | Name                        | Declared at                                                   |
| --------------- | --------------------------- | ------------------------------------------------------------- |
| Stores required |                             | `process/src/channels/http/http.sample-agents.channels.ts:10` |
| Secrets         | `openAi` (OPENAI_API_KEY)   | `process/src/app/sample-agents.app.ts:31`                     |
| Config          | `publicBaseUrl` (BASE_HOST) | `contract/src/sample-agents.config.ts:5`                      |

Anything else sample-agents needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name      | Token       | Module                          |
| --------- | ----------- | ------------------------------- |
| `apiKeys` | `ApiKeyApi` | [api-key](../api-key/README.md) |

## Who depends on sample-agents

No module names sample-agents as a peer.

<!-- readme:generated:end -->
