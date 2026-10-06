# github

The GitHub integration: app installations, their webhooks, and the pull requests other modules link to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                    |
| Subjects       | github, github-installation, github-pull-request                                                   |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                           |
| Api token      | `GithubApi` = `moduleApi<GithubApi>()("github")`, `contract/src/github.api.ts:114` (33 operations) |
| Other token    | `GithubInstallApi`, `process/src/transport/github-install.rest.ts:63`                              |
| Other token    | `GithubConnectionApi`, `process/src/transport/github.trpc.ts:34`                                   |
| Installed by   | api, worker, tasks (process); ui (browser)                                                         |

## What github owns

| Kind                           | Name                                                                                         | Declared at                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Postgres, accessed not claimed | `GithubBranchPullRequestCheck`, `GithubInstallation`, `GithubPullRequest`                    | `process/src/repositories/prisma/prisma.github-pull-requests.repository.ts:54` |
| Stores required                | prisma, redis                                                                                | `process/src/repositories/live/live.github.repositories.ts:11`                 |
| Stores required                | prisma                                                                                       | `process/src/repositories/prisma/prisma.github.repositories.ts:13`             |
| Secrets                        | GITHUB_LANGY_PRIVATE_KEY                                                                     | `process/src/app/github.app.ts:217`                                            |
| Config                         | `appId` (GITHUB_LANGY_APP_ID), `host` (GITHUB_LANGY_HOST), `appSlug` (GITHUB_LANGY_APP_SLUG) | `contract/src/github.config.ts:11`                                             |

Anything else github needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `auditLog`      | `AuditLogApi`     | [audit-log](../audit-log/README.md)       |
| `auth`          | `AuthApi`         | [auth](../auth/README.md)                 |
| `codingAgents`  | `CodingAgentApi`  | [coding-agent](../coding-agent/README.md) |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `permissions`   | `AuthzApi`        | [authz](../authz/README.md)               |
| `projects`      | `ProjectApi`      | [project](../project/README.md)           |

## Who depends on github

[coding-agent](../coding-agent/README.md), [langy](../langy/README.md), [ops](../ops/README.md) (as a peer).

<!-- readme:generated:end -->
