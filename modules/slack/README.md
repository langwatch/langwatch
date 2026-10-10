# slack

A project's Slack connections: the bot tokens automations post with, and the claims that keep two automations from fighting over one channel.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                               |
| Subjects       | slack, slack-integration                                                                      |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                      |
| Api token      | `SlackApi` = `moduleApi<SlackApi>()("slack")`, `contract/src/slack.api.ts:77` (10 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                    |

## What slack owns

| Kind            | Name                                                                                                                                      | Declared at                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Postgres table  | `SlackConnectionClaim` (`slack_connection_claim`)                                                                                         | `process/src/repositories/prisma/prisma.slack-connection-claim.repository.ts:33` |
| Postgres table  | `SlackIntegration`                                                                                                                        | `process/src/repositories/prisma/prisma.slack-connection.repository.ts:59`       |
| Stores required |                                                                                                                                           | `process/src/channels/http/http.slack.channels.ts:8`                             |
| Stores required | prisma, encryption                                                                                                                        | `process/src/repositories/prisma/prisma.slack.repositories.ts:17`                |
| Secrets         | `fingerprintKey` (CREDENTIALS_SECRET), `fingerprintKeyFallback` (NEXTAUTH_SECRET), `fingerprintKeyPrevious` (CREDENTIALS_SECRET_PREVIOUS) | `process/src/app/slack.app.ts:45`                                                |
| Config          | `slackApiBase` (SLACK_API_BASE)                                                                                                           | `contract/src/slack.config.ts:4`                                                 |

Anything else slack needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `authorization` | `AuthzApi`        | [authz](../authz/README.md)               |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `projects`      | `ProjectApi`      | [project](../project/README.md)           |

## Who depends on slack

[automation](../automation/README.md) (as a peer).

<!-- readme:generated:end -->
