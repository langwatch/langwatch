# @langwatch/enterprise-digest-process

The server half of [digest](../README.md). Weekly digest emails: folds the week's usage, picks a template per person and sends it.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("digest").withRepositories(digestRepositories).withChannels(digestChannels).withApi(DigestModule).withTransports(digestTrpcTransport, digestUnsubscribeRest).provideMiddlewareContext(…).withEventing(digestEventing).withEventing(digestSendEventing)`, `src/digest.module.ts:15`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DigestApi`)

The weekly digest. The operator controls admit Cloud admin staff through `OpsApi.admitCloudAdmin`, so they answer not_found where cloud ops is off (§3.5); the token operations serve the public unsubscribe address, whose signed token is the authorization.

Peers call these through the token, declared at `../contract/src/digest.api.ts:20`; nothing else in this package is public.

#### `setEnrolled`

```typescript
setEnrolled(input: DigestSetEnrolledInput & Operated): Promise<DigestSettings>;
```

#### `setArmed`

```typescript
setArmed(input: DigestSetArmedInput & Operated): Promise<DigestSettings>;
```

#### `sendTest`

Mails the member's week to the operator alone; no send is recorded.

```typescript
sendTest(input: DigestSendTestInput & Operated): Promise<void>;
```

#### `isSubscribed`

Whether the person the token names still receives the digest. Each of the three token operations counts one attempt per caller before anything is read, and refuses past the limit with `digest_unsubscribe_rate_limited`.

```typescript
isSubscribed(input: DigestTokenCall): Promise<boolean>;
```

#### `unsubscribe`

Opts the person out and records the send the link came from; asking twice changes nothing.

```typescript
unsubscribe(input: DigestTokenCall): Promise<void>;
```

#### `resubscribe`

Opts the person back in, from the same link.

```typescript
resubscribe(input: DigestTokenCall): Promise<void>;
```

## REST transport

### `digestUnsubscribeRest`

|             |                                               |
| ----------- | --------------------------------------------- |
| Declared at | `src/transport/digest-unsubscribe.rest.ts:45` |
| Base URL    | none: each route's path is its address        |
| Addressing  | literal                                       |
| Credential  | project                                       |

#### `GET /api/digest/unsubscribe` · `readDigestSubscription`

The weekly digest's unsubscribe page

Public: RFC 8058 one-click unsubscribe from the weekly digest: the email arrives where no session exists, and the HMAC token naming one person is the whole authorization. Hidden from the OpenAPI document. Declared at `src/transport/digest-unsubscribe.rest.ts:51`.

Answers at `/api/digest/unsubscribe`.

```typescript
// Query: digestTokenQuerySchema, ../contract/src/digest.ts:67
interface Query {
  token: string;
}
// Response: inline, src/transport/digest-unsubscribe.rest.ts:54
type Response = unknown;
```

#### `POST /api/digest/unsubscribe` · `unsubscribeFromDigest`

RFC 8058 one-click unsubscribe from the weekly digest

Public: RFC 8058 one-click unsubscribe from the weekly digest: the email arrives where no session exists, and the HMAC token naming one person is the whole authorization. Hidden from the OpenAPI document. Declared at `src/transport/digest-unsubscribe.rest.ts:70`.

Answers at `/api/digest/unsubscribe`.

```typescript
type Query = z.infer<typeof digestTokenQuerySchema>; // ../contract/src/digest.ts:67
// Response: inline, src/transport/digest-unsubscribe.rest.ts:76
type Response = unknown;
```

#### `POST /api/digest/resubscribe` · `resubscribeToDigest`

Resubscribe to the weekly digest from its unsubscribe page

Public: RFC 8058 one-click unsubscribe from the weekly digest: the email arrives where no session exists, and the HMAC token naming one person is the whole authorization. Hidden from the OpenAPI document. Declared at `src/transport/digest-unsubscribe.rest.ts:88`.

Answers at `/api/digest/resubscribe`.

```typescript
type Query = z.infer<typeof digestTokenQuerySchema>; // ../contract/src/digest.ts:67
// Response: inline, src/transport/digest-unsubscribe.rest.ts:94
type Response = unknown;
```

## tRPC transport

### `digest`

Contract `../contract/src/digest.trpc.ts:13`, router `src/transport/digest.trpc.ts:21`.

| Procedure            | Kind     | Gate                             | Input                          | Output                     |
| -------------------- | -------- | -------------------------------- | ------------------------------ | -------------------------- |
| `digest.setEnrolled` | mutation | Platform permission `ops:manage` | `digestSetEnrolledInputSchema` | `digestSettingsSchema`     |
| `digest.setArmed`    | mutation | Platform permission `ops:manage` | `digestSetArmedInputSchema`    | `digestSettingsSchema`     |
| `digest.sendTest`    | mutation | Platform permission `ops:manage` | `digestSendTestInputSchema`    | `digestAcknowledgedSchema` |

```typescript
// digest.setEnrolled
// Input: digestSetEnrolledInputSchema, ../contract/src/digest.ts:34
interface Input {
  organizationId: string;
  enrolled: boolean;
}
// Output: digestSettingsSchema, ../contract/src/digest.ts:23
interface Output {
  armed: boolean;
  enrolledOrganizationIds: string[];
}

// digest.setArmed
// Input: digestSetArmedInputSchema, ../contract/src/digest.ts:42
interface Input {
  armed: boolean;
}
type Output = z.infer<typeof digestSettingsSchema>; // ../contract/src/digest.ts:23

// digest.sendTest
// Input: digestSendTestInputSchema, ../contract/src/digest.ts:54
interface Input {
  organizationId: string;
  userId: string;
}
// Output: digestAcknowledgedSchema, ../contract/src/digest.ts:62
interface Output {
  ok: true;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `digest_send` (aggregate `digest_send`)

Declared at `src/eventing/digest-send.pipeline.ts:56`. Events: `DigestSendRequestedEventSchema`.

| Kind            | Name               | Handles                                                                             | Declared at                               |
| --------------- | ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| command         | `requestSend`      | –                                                                                   | `src/eventing/digest-send.pipeline.ts:61` |
| process manager | `digestWeeklyPlan` | every 1 h (`DIGEST_PLAN_INTERVAL_MS = 60 * 60 * 1000`); intents `planWeek` (outbox) | `src/eventing/digest-send.pipeline.ts:62` |
| process manager | `digestMemberSend` | intents `sendDigest` (outbox)                                                       | `src/eventing/digest-send.pipeline.ts:74` |

### Pipeline `digest` (aggregate `digest_week`)

Declared at `src/eventing/digest.pipeline.ts:82`. Events: `projectActivityRecordedEventSchema`, `userActivityRecordedEventSchema`.

| Kind                | Name                                                    | Handles                                                                                                                | Declared at                           |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| command             | `recordProjectActivity`                                 | –                                                                                                                      | `src/eventing/digest.pipeline.ts:128` |
| command             | `recordUserActivity`                                    | –                                                                                                                      | `src/eventing/digest.pipeline.ts:129` |
| peer subscriber     | `spanRecorded`                                          | `lw.trace.span_recorded` from [trace](../../../../modules/trace/README.md)                                             | `src/eventing/digest.pipeline.ts:90`  |
| peer subscriber     | `evaluationCompleted`                                   | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)                        | `src/eventing/digest.pipeline.ts:96`  |
| peer subscriber     | `scenarioRunFinished`                                   | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                                   | `src/eventing/digest.pipeline.ts:104` |
| peer subscriber     | `codingAgentSpanFacts`                                  | `lw.obs.coding_agent_session.span_facts_contributed` from [coding-agent](../../../../modules/coding-agent/README.md)   | `src/eventing/digest.pipeline.ts:110` |
| peer subscriber     | `codingAgentMetricFacts`                                | `lw.obs.coding_agent_session.metric_facts_contributed` from [coding-agent](../../../../modules/coding-agent/README.md) | `src/eventing/digest.pipeline.ts:116` |
| peer subscriber     | `userErased`                                            | `lw.user.erased` from [user](../../../../modules/user/README.md)                                                       | `src/eventing/digest.pipeline.ts:123` |
| Postgres projection | `≈ projectWeekProjection({ store: deps.projectWeeks })` | –                                                                                                                      | `src/eventing/digest.pipeline.ts:87`  |
| Postgres projection | `≈ userWeekProjection({ store: deps.userWeeks })`       | –                                                                                                                      | `src/eventing/digest.pipeline.ts:88`  |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                          |
| ------ | --------------- | -------------------- | ------------------------------------ |
| secret | `unsubscribe`   | `NEXTAUTH_SECRET`    | `src/app/digest.app.ts:69`           |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/digest.config.ts:5` |

<!-- readme:generated:end -->
