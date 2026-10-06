# stored-object

Stored objects: uploads and stored bytes, their metadata, and how each is delivered back.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                              |
| Subjects       | stored-object                                                                                                                |
| Halves         | [contract](contract) · [process](process)                                                                                    |
| Api token      | `StoredObjectApi` = `moduleApi<StoredObjectApi>()("stored-object")`, `contract/src/stored-object.api.ts:184` (18 operations) |
| Other token    | `StoredObjectFileApi`, `process/src/transport/stored-object-file.rest.ts:30`                                                 |
| Other token    | `StoredObjectImageProxyApi`, `process/src/transport/stored-object-image-proxy.rest.ts:15`                                    |
| Installed by   | api, worker, tasks (process)                                                                                                 |

## What stored-object owns

| Kind                           | Name                                                                                                                                                                                                              | Declared at                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Postgres table                 | `StoredObject`                                                                                                                                                                                                    | `process/src/repositories/prisma/prisma.stored-object-record.repository.ts:18`              |
| Postgres, accessed not claimed | `Project`                                                                                                                                                                                                         | `process/src/repositories/prisma/prisma.stored-object-project-organization.repository.ts:4` |
| Stores required                | prisma, clickhouse, objectStorage, encryption, rateLimiter                                                                                                                                                        | `process/src/repositories/live/live.stored-object.repositories.ts:21`                       |
| Config                         | `azureSpoolRetentionConfirmed` (AZURE_BLOB_SPOOL_RETENTION_CONFIRMED), `blockLocalHttpCalls` (BLOCK_LOCAL_HTTP_CALLS), `allowedProxyHosts` (ALLOWED_PROXY_HOSTS), `isSaas` (IS_SAAS), `publicBaseUrl` (BASE_HOST) | `contract/src/stored-object.config.ts:14`                                                   |

Anything else stored-object needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name    | Token      | Module                      |
| ------- | ---------- | --------------------------- |
| `authz` | `AuthzApi` | [authz](../authz/README.md) |

## Who depends on stored-object

[dataset](../dataset/README.md), [experiment](../experiment/README.md), [ops](../ops/README.md), [trace](../trace/README.md), [user](../user/README.md) (as a peer).

<!-- readme:generated:end -->
