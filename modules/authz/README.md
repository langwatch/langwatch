# authz

Authorization: who may do what, answered from grants and effective permissions. Every door asks it through `AuthzApi` before a handler runs.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                |
| Subjects       | authz, authz-grant                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                       |
| Api token      | `AuthzApi` = `moduleApi<AuthzApi>()("authz")`, `contract/src/authz.api.ts:282` (79 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                     |

## What authz owns

| Kind                           | Name                                                                                                                                                          | Declared at                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Postgres, accessed not claimed | `CustomRole`, `Grant`, `Role`, `RoleBinding`, `ShareLink`                                                                                                     | `process/src/repositories/prisma/prisma.authz-projection.repository.ts:74` |
| Stores required                | prisma, redis                                                                                                                                                 | `process/src/repositories/live/live.authz.repositories.ts:19`              |
| Config                         | `epochCacheEnabled` (AUTHZ_EPOCH_CACHE), `demoProjectId` (DEMO_PROJECT_ID), `demoProjectUserId` (DEMO_PROJECT_USER_ID), `demoProjectSlug` (DEMO_PROJECT_SLUG) | `contract/src/authz.config.ts:18`                                          |

Anything else authz needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: authz declares no peers.

## Who depends on authz

[agent](../agent/README.md), [analytics](../analytics/README.md), [annotation](../annotation/README.md), [api-key](../api-key/README.md), [auth](../auth/README.md), [automation](../automation/README.md), [billing](../../enterprise/modules/billing/README.md), [coding-agent](../coding-agent/README.md), [connect](../../enterprise/modules/connect/README.md), [dashboard](../dashboard/README.md), [data-privacy](../data-privacy/README.md), [data-retention](../data-retention/README.md), [dataset](../dataset/README.md), [enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md), [evaluation](../evaluation/README.md), [evaluator](../evaluator/README.md), [experiment](../experiment/README.md), [feature-flag](../feature-flag/README.md), [gateway](../gateway/README.md), [github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [hosted-mcp](../hosted-mcp/README.md), [identity](../identity/README.md), [insight](../insight/README.md), [instant-eval](../instant-eval/README.md), [langy](../langy/README.md), [licensing](../../enterprise/modules/licensing/README.md), [model-provider](../model-provider/README.md), [monitor](../monitor/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [project](../project/README.md), [prompt](../prompt/README.md), [role](../role/README.md), [scenario](../scenario/README.md), [scim](../../enterprise/modules/scim/README.md), [secret](../secret/README.md), [share](../share/README.md), [slack](../slack/README.md), [sso](../../enterprise/modules/sso/README.md), [stored-object](../stored-object/README.md), [trace](../trace/README.md), [user](../user/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
