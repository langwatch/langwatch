# organization

Organisations and who is in them: membership, invites, teams, groups and personal workspaces, and the sign-up checks that create them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                             |
| Subjects       | group, invite, membership, organization, personal-workspace, personal-workspace-features, team                              |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)                                 |
| Api token      | `OrganizationApi` = `moduleApi<OrganizationApi>()("organization")`, `contract/src/organization.api.ts:857` (150 operations) |
| Other token    | `TeamManagementApi`, `process/src/transport/team.rest.ts:62`                                                                |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                                  |

## What organization owns

| Kind                           | Name                                                                                                                                              | Declared at                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Postgres, accessed not claimed | `User`                                                                                                                                            | `process/src/repositories/prisma/prisma.organization-user-directory.repository.ts:6` |
| Stores required                | prisma, encryption, redis                                                                                                                         | `process/src/repositories/live/live.organization.repositories.ts:9`                  |
| Secrets                        | `internalSlackSignupsWebhook` (SLACK_CHANNEL_SIGNUPS)                                                                                             | `process/src/app/organization.app.ts:336`                                            |
| Config                         | `signUp.mode` (SIGN_UP_MODE), `signUp.allowedDomains` (SIGN_UP_ALLOWED_DOMAINS), `signUp.adminEmails` (ADMIN_EMAILS), `publicBaseUrl` (BASE_HOST) | `contract/src/organization.config.ts:17`                                             |

Anything else organization needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                    |
| --------------- | --------------------- | ----------------------------------------- |
| `apiKeys`       | `ApiKeyApi`           | [api-key](../api-key/README.md)           |
| `entitlement`   | `EntitlementApi`      | [entitlement](../entitlement/README.md)   |
| `identity`      | `IdentityApi`         | [identity](../identity/README.md)         |
| `notifications` | `NotificationService` | [notification](../notification/README.md) |
| `permissions`   | `AuthzApi`            | [authz](../authz/README.md)               |
| `projects`      | `ProjectApi`          | [project](../project/README.md)           |
| `roles`         | `RoleApi`             | [role](../role/README.md)                 |
| `users`         | `UserApi`             | [user](../user/README.md)                 |

## Who depends on organization

[annotation](../annotation/README.md), [api-key](../api-key/README.md), [auth](../auth/README.md), [billing](../../enterprise/modules/billing/README.md), [coding-agent](../coding-agent/README.md), [data-retention](../data-retention/README.md), [demo-data](../../enterprise/modules/demo-data/README.md), [enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md), [entitlement](../entitlement/README.md), [feature-flag](../feature-flag/README.md), [gateway](../gateway/README.md), [github](../github/README.md), [governance](../../enterprise/modules/governance/README.md), [identity](../identity/README.md), [instant-eval](../instant-eval/README.md), [licensing](../../enterprise/modules/licensing/README.md), [model-provider](../model-provider/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [project](../project/README.md), [scim](../../enterprise/modules/scim/README.md), [slack](../slack/README.md), [user](../user/README.md) (as a peer).

<!-- readme:generated:end -->
