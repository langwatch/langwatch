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

| Kind            | Name                                                                                                                                                                                                                                                                                                                                                                         | Declared at                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Postgres table  | `Notification`                                                                                                                                                                                                                                                                                                                                                               | `process/src/repositories/prisma/prisma.notification.repository.ts:13`          |
| Postgres table  | `WebPushSubscription`                                                                                                                                                                                                                                                                                                                                                        | `process/src/repositories/prisma/prisma.web-push-subscription.repository.ts:14` |
| Postgres table  | `WebPushVapidKey`                                                                                                                                                                                                                                                                                                                                                            | `process/src/repositories/prisma/prisma.web-push-vapid-key.repository.ts:17`    |
| Stores required | prisma, encryption                                                                                                                                                                                                                                                                                                                                                           | `process/src/repositories/prisma/prisma.notification.repositories.ts:13`        |
| Secrets         | `sendgrid` (SENDGRID_API_KEY), `smtpUrl` (SMTP_URL), `smtpPassword` (SMTP_PASSWORD), `resend` (RESEND_API_KEY)                                                                                                                                                                                                                                                               | `process/src/app/notification.app.ts:57`                                        |
| Config          | `defaultFrom` (EMAIL_DEFAULT_FROM), `provider` (EMAIL_PROVIDER), `ses.enabled` (USE_AWS_SES), `ses.region` (AWS_REGION), `ses.endpoint` (AWS_SES_ENDPOINT), `smtp.host` (SMTP_HOST), `smtp.port` (SMTP_PORT), `smtp.user` (SMTP_USER), `smtp.secure` (SMTP_SECURE), `publicBaseUrl` (BASE_HOST), `outboundProxy` (HTTPS_PROXY), `webPushServiceBase` (WEB_PUSH_SERVICE_BASE) | `contract/src/notification.config.ts:20`                                        |

Anything else notification needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: notification declares no peers.

## Who depends on notification

[auth](../auth/README.md), [automation](../automation/README.md), [billing](../../enterprise/modules/billing/README.md), [identity](../identity/README.md), [langy](../langy/README.md), [monitor](../monitor/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [user](../user/README.md) (as a peer).

<!-- readme:generated:end -->

## Customer.io on LangWatch Cloud

On a deployment with `IS_SAAS` set and `CUSTOMER_IO_APP_API_KEY` present, a fixed list of
templates goes through Customer.io's transactional API (`POST /v1/send/email`, EU unless
`CUSTOMER_IO_REGION=us`): the list is `CUSTOMER_IO_ROUTES` in
`process/src/rules/customer-io-routing.rules.ts`, and security mail is never on it. Behaviour:
[customer-io-transactional.feature](specs/customer-io-transactional.feature).

- **One request per recipient**, with our own subject and HTML, link tracking off, the person
  identified by address. A replyless send keeps the real recipient and answers to the no-reply
  address.
- **Any failure falls back.** A non-2xx reply, a timeout (10 s), a network error or an unreadable
  reply sends that recipient through the install's own mailer, once, with a warning naming the
  template. Both failing raises the own mailer's error.
- **Self-hosted never sees it.** The key is not in the Helm chart, and without `IS_SAAS` or the
  key every send takes the own mailer, unchanged. Messages with attachments always do.
- **Before turning it on,** each template id on the list must exist in Customer.io as a
  transactional message whose trigger name is that id.
