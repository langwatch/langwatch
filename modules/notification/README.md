# notification

Notifications: the records shown to users, mail delivery and SMTP checks, and web push subscriptions.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                  |
| Subjects       | notification                                                                                                                     |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                         |
| Api token      | `NotificationService` = `moduleApi<NotificationService>()("notification")`, `contract/src/notification.api.ts:43` (9 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                                       |

## What notification owns

| Kind            | Name                                                                                                                                                                                                                                                                                                                           | Declared at                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Postgres table  | `Notification`                                                                                                                                                                                                                                                                                                                 | `process/src/repositories/prisma/prisma.notification.repository.ts:13`          |
| Postgres table  | `WebPushSubscription`                                                                                                                                                                                                                                                                                                          | `process/src/repositories/prisma/prisma.web-push-subscription.repository.ts:14` |
| Postgres table  | `WebPushVapidKey`                                                                                                                                                                                                                                                                                                              | `process/src/repositories/prisma/prisma.web-push-vapid-key.repository.ts:17`    |
| Stores required | prisma, encryption                                                                                                                                                                                                                                                                                                             | `process/src/repositories/prisma/prisma.notification.repositories.ts:13`        |
| Secrets         | `sendgrid` (SENDGRID_API_KEY), `smtpUrl` (SMTP_URL), `smtpPassword` (SMTP_PASSWORD), `resend` (RESEND_API_KEY)                                                                                                                                                                                                                 | `process/src/app/notification.app.ts:57`                                        |
| Config          | `defaultFrom` (EMAIL_DEFAULT_FROM), `provider` (EMAIL_PROVIDER), `ses.enabled` (USE_AWS_SES), `ses.region` (AWS_REGION), `ses.endpoint` (AWS_SES_ENDPOINT), `smtp.host` (SMTP_HOST), `smtp.port` (SMTP_PORT), `smtp.user` (SMTP_USER), `smtp.secure` (SMTP_SECURE), `publicBaseUrl` (BASE_HOST), `outboundProxy` (HTTPS_PROXY) | `contract/src/notification.config.ts:13`                                        |

Anything else notification needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: notification declares no peers.

## Who depends on notification

[auth](../auth/README.md), [automation](../automation/README.md), [billing](../../enterprise/modules/billing/README.md), [identity](../identity/README.md), [langy](../langy/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [user](../user/README.md) (as a peer).

<!-- readme:generated:end -->
