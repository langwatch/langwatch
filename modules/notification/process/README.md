# @langwatch/notification-process

The server half of [notification](../README.md). Notifications: the records shown to users, mail delivery and SMTP checks, and web push subscriptions.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("notification").withRepositories(notificationRepositories).withApi(NotificationModule).withTransports(notificationTrpcTransport).withEventing(webPushEventing)`, `src/notification.module.ts:16`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`NotificationService`)

Peers call these through the token, declared at `../contract/src/notification.api.ts:18`; nothing else in this package is public.

#### `listRecentByOrganization`

```typescript
listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
```

#### `create`

```typescript
create(input: CreateNotificationCommand): Promise<Notification>;
```

#### `getMailDelivery`

Which gateway this install names for outbound mail, and whether SMTP is set up.

```typescript
getMailDelivery(): Promise<MailDeliveryView>;
```

#### `verifySmtp`

Opens a connection to the SMTP relay and closes it; throws the relay's refusal.

```typescript
verifySmtp(): Promise<void>;
```

#### `sendEmail`

Sends one message through this install's gateway; with mail off it is skipped and logged.

```typescript
sendEmail(input: SendEmailCommand): Promise<void>;
```

#### `getWebPushPublicKey`

The VAPID public key browsers subscribe with: the configured pair where the deployment names one, else this installation's own pair, generated and stored on first use.

```typescript
getWebPushPublicKey(): Promise<WebPushPublicKey>;
```

#### `subscribeWebPush`

Stores one of the person's browsers; a browser that subscribes again replaces its row.

```typescript
subscribeWebPush(input: SubscribeWebPushCommand): Promise<void>;
```

#### `unsubscribeWebPush`

Forgets one of the person's browsers; a browser the person does not hold is ignored.

```typescript
unsubscribeWebPush(input: UnsubscribeWebPushCommand): Promise<void>;
```

#### `requestWebPushDelivery`

Queues one push to every browser the person subscribed and answers at once; the worker sends, retrying a busy push service. The same idempotency key queues nothing new.

```typescript
requestWebPushDelivery(input: RequestWebPushDeliveryCommand): Promise<WebPushDeliveryRequested>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `notification`

Contract `../contract/src/notification.ts:103`, router `src/transport/notification.trpc.ts:26`.

| Procedure                         | Kind     | Gate                                                                                              | Input  | Output                   |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------- | ------ | ------------------------ |
| `notification.webPushPublicKey`   | query    | No permission: the VAPID public key is public by design; any signed-in browser subscribes with it | inline | `webPushPublicKeySchema` |
| `notification.subscribeWebPush`   | mutation | No permission: acts on the session user's own browsers, so no tenant scope applies                | inline | –                        |
| `notification.unsubscribeWebPush` | mutation | No permission: acts on the session user's own browsers, so no tenant scope applies                | inline | –                        |

```typescript
// notification.webPushPublicKey
// Input: inline, ../contract/src/notification.ts:105
interface Input {}
// Output: webPushPublicKeySchema, ../contract/src/web-push.ts:106
interface Output {
  publicKey: string;
}

// notification.subscribeWebPush
// Input: inline, ../contract/src/notification.ts:110
interface Input {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

// notification.unsubscribeWebPush
// Input: inline, ../contract/src/notification.ts:114
interface Input {
  endpoint: string;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `notification_web_push` (aggregate `global`)

Declared at `src/eventing/web-push.pipeline.ts:98`.

| Kind            | Name                     | Handles                                                                                          | Declared at                             |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| process manager | `notificationWebPush`    | every 1 d (`WEB_PUSH_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `prune`, `send` (outbox) | `src/eventing/web-push.pipeline.ts:104` |
| peer subscriber | `webPushUserDeactivated` | `lw.user.deactivated` from [user](../../user/README.md)                                          | `src/eventing/web-push.pipeline.ts:123` |
| peer subscriber | `webPushUserErased`      | `lw.identity.user_erased` from [identity](../../identity/README.md)                              | `src/eventing/web-push.pipeline.ts:128` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                                 |
| ------ | --------------- | -------------------- | ------------------------------------------- |
| secret | `sendgrid`      | `SENDGRID_API_KEY`   | `src/app/notification.app.ts:57`            |
| secret | `smtpUrl`       | `SMTP_URL`           | `src/app/notification.app.ts:58`            |
| secret | `smtpPassword`  | `SMTP_PASSWORD`      | `src/app/notification.app.ts:59`            |
| secret | `resend`        | `RESEND_API_KEY`     | `src/app/notification.app.ts:60`            |
| config | `defaultFrom`   | `EMAIL_DEFAULT_FROM` | `../contract/src/notification.config.ts:13` |
| config | `provider`      | `EMAIL_PROVIDER`     | `../contract/src/notification.config.ts:14` |
| config | `ses.enabled`   | `USE_AWS_SES`        | `../contract/src/notification.config.ts:16` |
| config | `ses.region`    | `AWS_REGION`         | `../contract/src/notification.config.ts:17` |
| config | `ses.endpoint`  | `AWS_SES_ENDPOINT`   | `../contract/src/notification.config.ts:18` |
| config | `smtp.host`     | `SMTP_HOST`          | `../contract/src/notification.config.ts:21` |
| config | `smtp.port`     | `SMTP_PORT`          | `../contract/src/notification.config.ts:22` |
| config | `smtp.user`     | `SMTP_USER`          | `../contract/src/notification.config.ts:23` |
| config | `smtp.secure`   | `SMTP_SECURE`        | `../contract/src/notification.config.ts:24` |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/notification.config.ts:27` |
| config | `outboundProxy` | `HTTPS_PROXY`        | `../contract/src/notification.config.ts:29` |

<!-- readme:generated:end -->
