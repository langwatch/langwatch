# api-key

API keys: creating and updating them, resolving a presented token to its caller, and minting the short-lived keys runs and agent sandboxes use.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                      |
| Subjects       | api-key                                                                                              |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)          |
| Api token      | `ApiKeyApi` = `moduleApi<ApiKeyApi>()("api-key")`, `contract/src/api-key.api.ts:266` (50 operations) |
| Other token    | `ApiKeyProjectsDoorApi`, `process/src/transport/api-key-projects.rest.ts:58`                         |
| Installed by   | api, worker, tasks (process); ui (browser)                                                           |

## What api-key owns

| Kind            | Name                                                                                                                                                     | Declared at                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Stores required | prisma, encryption, redis                                                                                                                                | `process/src/repositories/live/live.api-key.repositories.ts:21` |
| Secrets         | `pepper` (API_KEY_PEPPER), `pepperFallback` (CREDENTIALS_SECRET), `pepperLastFallback` (NEXTAUTH_SECRET), `pepperPrevious` (CREDENTIALS_SECRET_PREVIOUS) | `process/src/app/api-key.app.ts:169`                            |

Anything else api-key needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `authorization` | `AuthzApi`        | [authz](../authz/README.md)               |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `projects`      | `ProjectApi`      | [project](../project/README.md)           |

## Who depends on api-key

[auth](../auth/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [governance](../../enterprise/modules/governance/README.md), [langy](../langy/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [platform-health](../platform-health/README.md), [scenario](../scenario/README.md), [trace](../trace/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
