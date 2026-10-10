# connect

The hosted end of LangWatch Connect on LangWatch Cloud: the three `/api/internal/gateway/connect/*` routes a connected self-hosted install reaches through the gateway (hosted instant evals, usage, and the customer's own contract-budget cap), behind the gateway's signed-call door. Licensing answers which active licence a managed key runs under and the contract terms; the install end of Connect stays in licensing.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                |
| Subjects       | connect-hosted                                                                                       |
| Halves         | [contract](contract) · [process](process/README.md)                                                  |
| Api token      | `ConnectApi` = `moduleApi<ConnectApi>()("connect")`, `contract/src/connect.api.ts:29` (3 operations) |
| Installed by   | api, worker, tasks (process)                                                                         |

## What connect owns

No table, store, secret or config: connect declares none.

Anything else connect needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token            | Module                                                  |
| ------------- | ---------------- | ------------------------------------------------------- |
| `gateway`     | `GatewayApi`     | [gateway](../../../modules/gateway/README.md)           |
| `instantEval` | `InstantEvalApi` | [instant-eval](../../../modules/instant-eval/README.md) |
| `licensing`   | `LicensingApi`   | [licensing](../licensing/README.md)                     |
| `scopes`      | `AuthzApi`       | [authz](../../../modules/authz/README.md)               |

## Who depends on connect

No module names connect as a peer.

<!-- readme:generated:end -->
