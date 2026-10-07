# webhook

Webhook endpoints: creating and managing them, signing secrets, and delivering events to them with a delivery log and health per endpoint.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                       |
| Subjects       | webhook                                                                                               |
| Halves         | [contract](contract) · [process](process/README.md)                                                   |
| Api token      | `WebhookApi` = `moduleApi<WebhookApi>()("webhook")`, `contract/src/webhook.api.ts:89` (21 operations) |
| Other token    | `WebhookSpendReplayApi`, `process/src/transport/webhook-spend-replay.rest.ts:27`                      |
| Installed by   | api, worker, tasks (process)                                                                          |

## What webhook owns

| Kind            | Name                                                                                                                                                                                     | Declared at                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Postgres table  | `WebhookEndpoint`                                                                                                                                                                        | `process/src/repositories/prisma/prisma.webhook-endpoint.repository.ts:162` |
| Postgres table  | `WebhookEndpointDelivery`                                                                                                                                                                | `process/src/repositories/prisma/prisma.webhook-endpoint.repository.ts:162` |
| Stores required | prisma, encryption, redis, rateLimiter                                                                                                                                                   | `process/src/repositories/prisma/prisma.webhook.repositories.ts:54`         |
| Config          | `allowInsecureLocalUrls` (WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS), `allowAmbientAwsCredentials` (WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS), `isSaas` (IS_SAAS), `outboundProxy` (HTTPS_PROXY) | `contract/src/webhook.config.ts:13`                                         |

Anything else webhook needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token            | Module                                  |
| ------------- | ---------------- | --------------------------------------- |
| `entitlement` | `EntitlementApi` | [entitlement](../entitlement/README.md) |
| `gateway`     | `GatewayApi`     | [gateway](../gateway/README.md)         |
| `projects`    | `ProjectApi`     | [project](../project/README.md)         |

## Who depends on webhook

[automation](../automation/README.md) (as a peer).

<!-- readme:generated:end -->
