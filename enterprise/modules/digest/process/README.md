# @langwatch/enterprise-digest-process

The server half of [digest](../README.md). Weekly digest emails: folds the week's usage, picks a template per person and sends it.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("digest").withRepositories(digestRepositories).withChannels(digestChannels).withApi(DigestModule).withTransports(digestTrpcTransport, digestUnsubscribeRest).provideMiddlewareContext(…).withEventing(digestEventing).withEventing(digestSendEventing)`, `src/digest.module.ts:15`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DigestApi`)

The weekly digest, sent to every organization's members. The operator controls admit Cloud admin staff through `OpsApi.admitCloudAdmin`, so they answer not_found where cloud ops is off (§3.5); the token operations serve the public unsubscribe address, whose signed token is the authorization.

Peers call these through the token, declared at `../contract/src/digest.api.ts:23`; nothing else in this package is public.

#### `setArmed`

```typescript
setArmed(input: DigestSetArmedInput & Operated): Promise<DigestSettings>;
```

#### `sendTest`

Mails the member's week to the operator alone; no send is recorded.

```typescript
sendTest(input: DigestSendTestInput & Operated): Promise<void>;
```

#### `sendMyTests`

Mails the operator, as a test, their own week in every organization they are an active member of; an organization with nothing to send is skipped and reported, not refused.

```typescript
sendMyTests(input: Operated): Promise<DigestMyTests>;
```

#### `sendTestFor`

Mails the operator, or with `deliverTo: "person"` the person at their own address, as tests, the person's week in each organization they are an active member of: what they would get, or the template forced, skipped where it has no data. An address no account has is refused with `digest_person_not_found`.

```typescript
sendTestFor(input: DigestSendTestForInput & Operated): Promise<DigestTestsFor>;
```

#### `getPreference`

The signed-in person's own choice; the caller names themselves, never anyone else.

```typescript
getPreference(input: Readonly<{ userId: string }>): Promise<DigestPreference>;
```

#### `setPreference`

Opts the signed-in person in or out of every organization's digest at once. Staff impersonating them (`impersonatorId`) are refused with `digest_impersonation_refused`.

```typescript
setPreference(input: Readonly<{ userId: string; impersonatorId?: string | undefined } & DigestPreference>): Promise<DigestPreference>;
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
// Query: digestTokenQuerySchema, ../contract/src/digest.ts:149
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
type Query = z.infer<typeof digestTokenQuerySchema>; // ../contract/src/digest.ts:149
// Response: inline, src/transport/digest-unsubscribe.rest.ts:76
type Response = unknown;
```

#### `POST /api/digest/resubscribe` · `resubscribeToDigest`

Resubscribe to the weekly digest from its unsubscribe page

Public: RFC 8058 one-click unsubscribe from the weekly digest: the email arrives where no session exists, and the HMAC token naming one person is the whole authorization. Hidden from the OpenAPI document. Declared at `src/transport/digest-unsubscribe.rest.ts:88`.

Answers at `/api/digest/resubscribe`.

```typescript
type Query = z.infer<typeof digestTokenQuerySchema>; // ../contract/src/digest.ts:149
// Response: inline, src/transport/digest-unsubscribe.rest.ts:94
type Response = unknown;
```

## tRPC transport

### `digest`

Contract `../contract/src/digest.trpc.ts:20`, router `src/transport/digest.trpc.ts:24`.

| Procedure                | Kind     | Gate                                                                                  | Input                          | Output                     |
| ------------------------ | -------- | ------------------------------------------------------------------------------------- | ------------------------------ | -------------------------- |
| `digest.setArmed`        | mutation | Platform permission `ops:manage`                                                      | `digestSetArmedInputSchema`    | `digestSettingsSchema`     |
| `digest.sendTest`        | mutation | Platform permission `ops:manage`                                                      | `digestSendTestInputSchema`    | `digestAcknowledgedSchema` |
| `digest.sendMyTests`     | mutation | Platform permission `ops:manage`                                                      | `digestNoInputSchema`          | `digestMyTestsSchema`      |
| `digest.sendTestFor`     | mutation | Platform permission `ops:manage`                                                      | `digestSendTestForInputSchema` | `digestTestsForSchema`     |
| `digest.getMyPreference` | query    | No permission: operates on the session user's own opt-out, so no tenant scope applies | `digestNoInputSchema`          | `digestPreferenceSchema`   |
| `digest.setMyPreference` | mutation | No permission: operates on the session user's own opt-out, so no tenant scope applies | `digestPreferenceSchema`       | `digestPreferenceSchema`   |

```typescript
// digest.setArmed
// Input: digestSetArmedInputSchema, ../contract/src/digest.ts:42
interface Input {
  armed: boolean;
}
// Output: digestSettingsSchema, ../contract/src/digest.ts:34
interface Output {
  armed: boolean;
}

// digest.sendTest
// Input: digestSendTestInputSchema, ../contract/src/digest.ts:65
interface Input {
  organizationId: string;
  userId: string;
}
// Output: digestAcknowledgedSchema, ../contract/src/digest.ts:144
interface Output {
  ok: true;
}

// digest.sendMyTests
// Input: digestNoInputSchema, ../contract/src/digest.ts:48
type Input = Record<string, unknown>;
type Output = z.infer<typeof digestMyTestsSchema>; // ../contract/src/digest.ts:107

// digest.sendTestFor
// Input: digestSendTestForInputSchema, ../contract/src/digest.ts:127
interface Input {
  email: string;
  template:
    | "auto"
    | "digest-plan-pressure"
    | "digest-scenarios-trend"
    | "digest-coding-agent-week"
    | "digest-traces-week";
  deliverTo?: "me" | "person";
}
type Output = z.infer<typeof digestTestsForSchema>; // ../contract/src/digest.ts:136

// digest.getMyPreference
type Input = z.infer<typeof digestNoInputSchema>; // ../contract/src/digest.ts:48
// Output: digestPreferenceSchema, ../contract/src/digest.ts:53
interface Output {
  subscribed: boolean;
}

// digest.setMyPreference
type Input = z.infer<typeof digestPreferenceSchema>; // ../contract/src/digest.ts:53
type Output = z.infer<typeof digestPreferenceSchema>; // ../contract/src/digest.ts:53
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `digest_send` (aggregate `digest_send`)

Declared at `src/eventing/digest-send.pipeline.ts:79`. Events: `DigestSendRequestedEventSchema`, `DigestOrganizationPlanRequestedEventSchema`.

| Kind            | Name                      | Handles                                                                             | Declared at                                |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| command         | `requestSend`             | –                                                                                   | `src/eventing/digest-send.pipeline.ts:84`  |
| command         | `requestOrganizationPlan` | –                                                                                   | `src/eventing/digest-send.pipeline.ts:85`  |
| process manager | `digestWeeklyPlan`        | every 1 h (`DIGEST_PLAN_INTERVAL_MS = 60 * 60 * 1000`); intents `planWeek` (outbox) | `src/eventing/digest-send.pipeline.ts:86`  |
| process manager | `digestOrganizationPlan`  | intents `planOrganization` (outbox)                                                 | `src/eventing/digest-send.pipeline.ts:98`  |
| process manager | `digestMemberSend`        | intents `sendDigest` (outbox)                                                       | `src/eventing/digest-send.pipeline.ts:112` |

### Pipeline `digest` (aggregate `digest_week`)

Declared at `src/eventing/digest.pipeline.ts:73`. Events: `projectActivityRecordedEventSchema`, `userActivityRecordedEventSchema`.

| Kind                | Name                                                    | Handles                                                                                                                | Declared at                           |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| command             | `recordProjectActivity`                                 | –                                                                                                                      | `src/eventing/digest.pipeline.ts:107` |
| command             | `recordUserActivity`                                    | –                                                                                                                      | `src/eventing/digest.pipeline.ts:108` |
| peer subscriber     | `evaluationCompleted`                                   | `lw.evaluation.lifecycle_completed` from [evaluation](../../../../modules/evaluation/README.md)                        | `src/eventing/digest.pipeline.ts:80`  |
| peer subscriber     | `scenarioRunFinished`                                   | `lw.simulation_run.finished` from [scenario](../../../../modules/scenario/README.md)                                   | `src/eventing/digest.pipeline.ts:85`  |
| peer subscriber     | `codingAgentSpanFacts`                                  | `lw.obs.coding_agent_session.span_facts_contributed` from [coding-agent](../../../../modules/coding-agent/README.md)   | `src/eventing/digest.pipeline.ts:91`  |
| peer subscriber     | `codingAgentMetricFacts`                                | `lw.obs.coding_agent_session.metric_facts_contributed` from [coding-agent](../../../../modules/coding-agent/README.md) | `src/eventing/digest.pipeline.ts:96`  |
| peer subscriber     | `userErased`                                            | `lw.user.erased` from [user](../../../../modules/user/README.md)                                                       | `src/eventing/digest.pipeline.ts:102` |
| Postgres projection | `≈ projectWeekProjection({ store: deps.projectWeeks })` | –                                                                                                                      | `src/eventing/digest.pipeline.ts:78`  |
| Postgres projection | `≈ userWeekProjection({ store: deps.userWeeks })`       | –                                                                                                                      | `src/eventing/digest.pipeline.ts:79`  |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                          |
| ------ | --------------- | -------------------- | ------------------------------------ |
| secret | `unsubscribe`   | `NEXTAUTH_SECRET`    | `src/app/digest.app.ts:74`           |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/digest.config.ts:5` |

<!-- readme:generated:end -->
