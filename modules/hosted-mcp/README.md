# hosted-mcp

The hosted MCP server, and the MCP OAuth flow that admits its clients.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                              |
| Subjects       | hosted-mcp, mcp-oauth                                                                                                        |
| Halves         | [contract](contract) · [process](process/README.md)                                                                          |
| Api token      | `HostedMcpApi` = `moduleApi<HostedMcpApiContract>()("hosted-mcp")`, `contract/src/mcp-authorize.schemas.ts:74` (1 operation) |
| Other token    | `McpAuthorizeApi`, `process/src/transport/mcp-authorize.rest.ts:23`                                                          |
| Installed by   | api, worker, tasks (process)                                                                                                 |

## What hosted-mcp owns

| Kind            | Name                        | Declared at                                                        |
| --------------- | --------------------------- | ------------------------------------------------------------------ |
| Stores required | encryption, redis           | `process/src/repositories/live/live.hosted-mcp.repositories.ts:16` |
| Config          | `publicBaseUrl` (BASE_HOST) | `contract/src/hosted-mcp.config.ts:5`                              |

Anything else hosted-mcp needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token               | Module                                                      |
| --------------- | ------------------- | ----------------------------------------------------------- |
| `authorization` | `AuthzApi`          | [authz](../authz/README.md)                                 |
| `governance`    | `GovernanceRestApi` | [governance](../../enterprise/modules/governance/README.md) |
| `projects`      | `ProjectApi`        | [project](../project/README.md)                             |
| `sessions`      | `AuthApi`           | [auth](../auth/README.md)                                   |

## Who depends on hosted-mcp

No module names hosted-mcp as a peer.

<!-- readme:generated:end -->
