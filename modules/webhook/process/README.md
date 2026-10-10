# @langwatch/webhook-process

The server half of [webhook](../README.md). Webhook endpoints: creating and managing them, signing secrets, and delivering events to them with a delivery log and health per endpoint.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("webhook").withRepositories(webhookRepositories).withChannels(webhookChannels).withApi(WebhookModule).withTransports(webhookEndpointTrpcTransport, webhookRest, webhookSpendReplayRest).withEventing(webhookDeliveryEventing).withTasks(…)`, `src/webhook.module.ts:18`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`WebhookApi`)

Peers call these through the token, declared at `../contract/src/webhook.api.ts:30`; nothing else in this package is public.

#### `create`

```typescript
create(input: CreateWebhookEndpointCommand): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
```

#### `getAll`

```typescript
getAll(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
```

#### `getById`

```typescript
getById(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
```

#### `update`

```typescript
update(input: UpdateWebhookEndpointCommand): Promise<WebhookEndpointView>;
```

#### `applyEndpointChanges`

Updates whatever fields were named, then moves the status when one was asked for.

```typescript
applyEndpointChanges(input: ApplyWebhookEndpointChangesCommand): Promise<WebhookEndpointView>;
```

#### `rollSecret`

```typescript
rollSecret(input: { organizationId: string; endpointId: string; }): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
```

#### `enable`

```typescript
enable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
```

#### `disable`

```typescript
disable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
```

#### `archive`

```typescript
archive(input: { organizationId: string; endpointId: string }): Promise<void>;
```

#### `findDeliverable`

```typescript
findDeliverable(input: { organizationId: string; endpointId: string; }): Promise<WebhookEndpointView | null>;
```

#### `getDeliveries`

One endpoint's delivery log, newest first, one page at a time.

```typescript
getDeliveries(input: { organizationId: string; endpointId: string; limit?: number; cursor?: WebhookDeliveryPosition; }): Promise<WebhookDeliveryLog>;
```

#### `getHealth`

```typescript
getHealth(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointHealth>;
```

#### `testFire`

Sends a signed test event through the exact hop a real delivery dispatches through, and records the attempt in the endpoint's delivery log.

```typescript
testFire(input: { organizationId: string; endpointId: string }): Promise<WebhookTestFireResult>;
```

#### `getEmittedEvents`

```typescript
getEmittedEvents(input: ListWebhookEventsQuery): Promise<ListWebhookEventsResult>;
```

#### `getEmittedEventById`

Throws `WebhookEventNotFoundError` when the log cannot answer for the id.

```typescript
getEmittedEventById(input: { organizationId: string; id: string }): Promise<WebhookEnvelope>;
```

#### `assertEndpointsEntitled`

```typescript
assertEndpointsEntitled(organizationId: string): Promise<void>;
```

#### `appendReplayToEndpointStream`

Re-delivers one already-emitted envelope through the endpoint's normal delivery path.

```typescript
appendReplayToEndpointStream(input: { organizationId: string; endpoint: { id: string; enabledEvents: readonly string[] }; envelope: WebhookEnvelope; replayId: string; }): Promise<void>;
```

#### `requestGatewayEventDelivery`

Queues one committed gateway event (spend or governance) for delivery; a repeat is dropped.

```typescript
requestGatewayEventDelivery(input: WebhookGatewayEventDeliveryRequest): Promise<void>;
```

#### `requestDelivery`

Queues one message for one endpoint and answers its delivery id at once (ADR-167). Call it from an outbox intent only; an unknown or archived endpoint throws, an inactive one skips.

```typescript
requestDelivery(input: WebhookDeliveryRequest): Promise<WebhookDeliveryRequestResult>;
```

#### `sendRequest`

Sends one attempt and logs it; throws a classified `DispatchError` for the outbox.

```typescript
sendRequest(input: WebhookSendRequest): Promise<WebhookSendRequestResult>;
```

#### `findDeliveriesBySource`

One source's recorded {@link sendRequest} attempts, newest first.

```typescript
findDeliveriesBySource(input: { projectId: string; source: WebhookRequestSource; limit: number; }): Promise<WebhookRequestDelivery[]>;
```

## REST transport

### `webhookSpendReplayRest`

|             |                                                 |
| ----------- | ----------------------------------------------- |
| Declared at | `src/transport/webhook-spend-replay.rest.ts:40` |
| Base URL    | none: each route's path is its address          |
| Addressing  | literal                                         |
| Credential  | organization                                    |

#### `POST /api/gateway/v1/spend-events/replay` · `replayGatewaySpendEvents`

Replay spend events to an endpoint

Permission `gatewaySpend:manage`. Entitlement `webhook_endpoints`. Declared at `src/transport/webhook-spend-replay.rest.ts:48`.

Answers at `/api/gateway/v1/spend-events/replay`.

```typescript
// Body: webhookSpendReplayBodySchema, ../contract/src/webhook-spend-replay.schemas.ts:14
interface Body {
  from: number;
  to: number;
  endpoint_id: string;
}
// Response: webhookSpendReplayResponseSchema, ../contract/src/webhook-spend-replay.schemas.ts:35
interface Response {
  data: {
    endpoint_id: string;
    replay_id: string;
    replayed: number;
    window: {
      from: string;
      to: string;
    };
  };
}
```

### `webhookRest`

|             |                                     |
| ----------- | ----------------------------------- |
| Declared at | `src/transport/webhook.rest.ts:151` |
| Base URL    | `/api/webhooks/v1`                  |
| Addressing  | v1-in-path                          |
| Credential  | organization                        |

#### `POST /endpoints` · `postApiWebhooksV1Endpoints`

Create a webhook endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:160`.

Answers at `/api/webhooks/v1/endpoints`.

```typescript
type Body = z.infer<typeof createEndpointSchema>; // ../contract/src/webhook-rest.schemas.ts:198
type Response = z.infer<typeof endpointWithSecretResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:124
```

#### `GET /endpoints` · `getApiWebhooksV1Endpoints`

List webhook endpoints

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:191`.

Answers at `/api/webhooks/v1/endpoints`.

```typescript
type Response = z.infer<typeof endpointListResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:102
```

#### `GET /endpoints/:id` · `getApiWebhooksV1EndpointsById`

Get a webhook endpoint

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:206`.

Answers at `/api/webhooks/v1/endpoints/:id`.

```typescript
// Params: endpointIdParams, src/transport/webhook.rest.ts:39
interface Params {
  id: string;
}
type Response = z.infer<typeof endpointResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:122
```

#### `PATCH /endpoints/:id` · `patchApiWebhooksV1EndpointsById`

Update a webhook endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:222`.

Answers at `/api/webhooks/v1/endpoints/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Body = z.infer<typeof updateEndpointSchema>; // ../contract/src/webhook-rest.schemas.ts:211
type Response = z.infer<typeof endpointResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:122
```

#### `DELETE /endpoints/:id` · `deleteApiWebhooksV1EndpointsById`

Archive a webhook endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:253`.

Answers at `/api/webhooks/v1/endpoints/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
// Response: endpointArchivedResponseSchema, ../contract/src/webhook-rest.schemas.ts:126
interface Response {
  data: {
    archived: true;
  };
}
```

#### `POST /endpoints/:id/roll-secret` · `postApiWebhooksV1EndpointsByIdRollSecret`

Roll an endpoint's signing secret

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:270`.

Answers at `/api/webhooks/v1/endpoints/:id/roll-secret`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
// Body: rollEndpointSecretBodySchema, ../contract/src/webhook-rest.schemas.ts:273
type Body = Record<string, unknown>;
type Response = z.infer<typeof endpointWithSecretResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:124
```

#### `POST /endpoints/:id/test` · `postApiWebhooksV1EndpointsByIdTest`

Send a test event to an endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:292`.

Answers at `/api/webhooks/v1/endpoints/:id/test`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
// Body: testEndpointBodySchema, ../contract/src/webhook-rest.schemas.ts:276
type Body = Record<string, unknown>;
// Response: testFireResponseSchema, ../contract/src/webhook-rest.schemas.ts:270
interface Response {
  data: {
    delivered: boolean;
    response_status: number | null;
    response_body?: string;
    error?: string;
  };
}
```

#### `GET /endpoints/:id/deliveries` · `getApiWebhooksV1EndpointsByIdDeliveries`

List an endpoint's delivery attempts

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:324`.

Answers at `/api/webhooks/v1/endpoints/:id/deliveries`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
// Query: deliveriesQuerySchema, ../contract/src/webhook-rest.schemas.ts:224
interface Query {
  cursor?: string;
  limit?: number;
}
type Response = z.infer<typeof deliveryListResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:110
```

#### `GET /endpoints/:id/health` · `getApiWebhooksV1EndpointsByIdHealth`

Read an endpoint's delivery health

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:363`.

Answers at `/api/webhooks/v1/endpoints/:id/health`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Response = z.infer<typeof healthResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:268
```

#### `GET /event-types` · `getApiWebhooksV1EventTypes`

List subscribable event types

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:393`.

Answers at `/api/webhooks/v1/event-types`.

```typescript
// Response: eventTypeListResponseSchema, ../contract/src/webhook-rest.schemas.ts:106
interface Response {
  data: {
    type: string;
    family: string;
    schema_version: string;
    is_emitting: boolean;
    description: string;
  }[];
}
```

#### `GET /events` · `getApiWebhooksV1Events`

List emitted events

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:416`.

Answers at `/api/webhooks/v1/events`.

```typescript
// Query: eventsQuerySchema, ../contract/src/webhook-rest.schemas.ts:229
interface Query {
  type?: string;
  from: number;
  to: number;
  cursor?: string;
  limit?: number;
}
// Response: webhookEventListResponseSchema, ../contract/src/webhook-rest.schemas.ts:115
interface Response {
  data: {
    id: string;
    type: string;
    created: string;
    schema_version: string;
    data: Record<string, unknown>;
  }[];
  next_cursor: string | null;
}
```

#### `GET /events/:id` · `getApiWebhooksV1EventsById`

Get one emitted event

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:444`.

Answers at `/api/webhooks/v1/events/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
// Response: webhookEventResponseSchema, ../contract/src/webhook-rest.schemas.ts:130
interface Response {
  data: {
    id: string;
    type: string;
    created: string;
    schema_version: string;
    data: Record<string, unknown>;
  };
}
```

## tRPC transport

### `webhookEndpoints`

Contract `../contract/src/webhook-endpoint.trpc.ts:74`, router `src/transport/webhook-endpoint.trpc.ts:13`.

| Procedure                     | Kind     | Gate                                 | Input                                    | Output                            |
| ----------------------------- | -------- | ------------------------------------ | ---------------------------------------- | --------------------------------- |
| `webhookEndpoints.eventTypes` | query    | Permission `webhookEndpoints:view`   | `webhookEndpointOrganizationScopeSchema` | inline                            |
| `webhookEndpoints.list`       | query    | Permission `webhookEndpoints:view`   | `webhookEndpointOrganizationScopeSchema` | inline                            |
| `webhookEndpoints.deliveries` | query    | Permission `webhookEndpoints:view`   | `webhookEndpointDeliveriesInputSchema`   | `webhookDeliveryPageSchema`       |
| `webhookEndpoints.create`     | mutation | Permission `webhookEndpoints:manage` | `webhookEndpointCreateInputSchema`       | `webhookEndpointWithSecretSchema` |
| `webhookEndpoints.health`     | query    | Permission `webhookEndpoints:view`   | `webhookEndpointScopeSchema`             | `webhookEndpointHealthSchema`     |
| `webhookEndpoints.update`     | mutation | Permission `webhookEndpoints:manage` | `webhookEndpointUpdateInputSchema`       | `webhookEndpointViewSchema`       |
| `webhookEndpoints.rollSecret` | mutation | Permission `webhookEndpoints:manage` | `webhookEndpointScopeSchema`             | `webhookEndpointWithSecretSchema` |
| `webhookEndpoints.enable`     | mutation | Permission `webhookEndpoints:manage` | `webhookEndpointScopeSchema`             | `webhookEndpointViewSchema`       |
| `webhookEndpoints.disable`    | mutation | Permission `webhookEndpoints:manage` | `webhookEndpointScopeSchema`             | `webhookEndpointViewSchema`       |
| `webhookEndpoints.archive`    | mutation | Permission `webhookEndpoints:manage` | `webhookEndpointScopeSchema`             | inline                            |

```typescript
// webhookEndpoints.eventTypes
// Input: webhookEndpointOrganizationScopeSchema, ../contract/src/webhook-endpoint.trpc.ts:19
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/webhook-endpoint.trpc.ts:78
type Output = {
  type: string;
  family: string;
  schemaVersion: "1";
  isEmitting: boolean;
  description: string;
}[];

// webhookEndpoints.list
type Input = z.infer<typeof webhookEndpointOrganizationScopeSchema>; // ../contract/src/webhook-endpoint.trpc.ts:19
// Output: webhookEndpointViewSchema.array() (inline, ../contract/src/webhook-endpoint.trpc.ts:82)

// webhookEndpoints.deliveries
// Input: webhookEndpointDeliveriesInputSchema, ../contract/src/webhook-endpoint.trpc.ts:41
interface Input {
  organizationId: string;
  endpointId: string;
  limit?: number;
  cursor?: {
    firedAt: unknown;
    id: string;
  };
}
type Output = z.infer<typeof webhookDeliveryPageSchema>; // ../contract/src/webhook.ts:122

// webhookEndpoints.create
type Input = z.infer<typeof webhookEndpointCreateInputSchema>; // ../contract/src/webhook-endpoint.trpc.ts:47
type Output = z.infer<typeof webhookEndpointWithSecretSchema>; // ../contract/src/webhook.ts:102

// webhookEndpoints.health
// Input: webhookEndpointScopeSchema, ../contract/src/webhook-endpoint.trpc.ts:23
interface Input {
  organizationId: string;
  endpointId: string;
}
// Output: webhookEndpointHealthSchema, ../contract/src/webhook.ts:83
interface Output {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: unknown | null;
  lastSuccessAt: unknown | null;
  lastFailureAt: unknown | null;
  oldestUndeliveredAgeMs: number | null;
  dlqDepth: number;
  sendsPerMinute: number;
  successRate: number | null;
  p95LatencyMs: number | null;
}

// webhookEndpoints.update
type Input = z.infer<typeof webhookEndpointUpdateInputSchema>; // ../contract/src/webhook-endpoint.trpc.ts:59
type Output = z.infer<typeof webhookEndpointViewSchema>; // ../contract/src/webhook.ts:51

// webhookEndpoints.rollSecret
type Input = z.infer<typeof webhookEndpointScopeSchema>; // ../contract/src/webhook-endpoint.trpc.ts:23
type Output = z.infer<typeof webhookEndpointWithSecretSchema>; // ../contract/src/webhook.ts:102

// webhookEndpoints.enable
type Input = z.infer<typeof webhookEndpointScopeSchema>; // ../contract/src/webhook-endpoint.trpc.ts:23
type Output = z.infer<typeof webhookEndpointViewSchema>; // ../contract/src/webhook.ts:51

// webhookEndpoints.disable
type Input = z.infer<typeof webhookEndpointScopeSchema>; // ../contract/src/webhook-endpoint.trpc.ts:23
type Output = z.infer<typeof webhookEndpointViewSchema>; // ../contract/src/webhook.ts:51

// webhookEndpoints.archive
type Input = z.infer<typeof webhookEndpointScopeSchema>; // ../contract/src/webhook-endpoint.trpc.ts:23
// Output: inline, ../contract/src/webhook-endpoint.trpc.ts:114
type Output = unknown;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `webhook_delivery` (aggregate `webhook_spend_delivery`)

Declared at `src/eventing/webhook-delivery.pipeline.ts:74`. Events: `webhookSpendDeliveryRequestedEventSchema`, `webhookGovernanceDeliveryRequestedEventSchema`.

The chain builds early when `!input.deliveryProcess || !input.governanceProcess || !input.gatewayEvents || !input.prune` (`src/eventing/webhook-delivery.pipeline.ts:85`); the rows built only past that return say so. The caller's arguments decide which role gets which build.

| Kind            | Name                              | Handles                                                                                 | Declared at                                     | Built                |
| --------------- | --------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------- |
| command         | `requestSpendDelivery`            | –                                                                                       | `src/eventing/webhook-delivery.pipeline.ts:82`  | always               |
| command         | `requestGovernanceDelivery`       | –                                                                                       | `src/eventing/webhook-delivery.pipeline.ts:83`  | always               |
| process manager | `webhookDelivery`                 | ≈ applier `input.deliveryProcess`                                                       | `src/eventing/webhook-delivery.pipeline.ts:91`  | past the early build |
| process manager | `governanceEventsDelivery`        | ≈ applier `input.governanceProcess`                                                     | `src/eventing/webhook-delivery.pipeline.ts:92`  | past the early build |
| process manager | `webhookDeliveryPrune`            | every 1 d (`WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `prune` | `src/eventing/webhook-delivery.pipeline.ts:93`  | past the early build |
| peer subscriber | `gatewaySpendAdmittedDelivery`    | `lw.gateway.spend.admitted` from [gateway](../../gateway/README.md)                     | `src/eventing/webhook-delivery.pipeline.ts:100` | past the early build |
| peer subscriber | `gatewaySpendConfirmedDelivery`   | `lw.gateway.spend.confirmed` from [gateway](../../gateway/README.md)                    | `src/eventing/webhook-delivery.pipeline.ts:101` | past the early build |
| peer subscriber | `gatewaySpendFailedDelivery`      | `lw.gateway.spend.failed` from [gateway](../../gateway/README.md)                       | `src/eventing/webhook-delivery.pipeline.ts:102` | past the early build |
| peer subscriber | `gatewaySpendSettledDelivery`     | `lw.gateway.spend.settled` from [gateway](../../gateway/README.md)                      | `src/eventing/webhook-delivery.pipeline.ts:103` | past the early build |
| peer subscriber | `gatewayBudgetCrossingDelivery`   | `lw.governance.budget_crossing` from [gateway](../../gateway/README.md)                 | `src/eventing/webhook-delivery.pipeline.ts:104` | past the early build |
| peer subscriber | `gatewayVkLifecycleDelivery`      | `lw.governance.vk_lifecycle` from [gateway](../../gateway/README.md)                    | `src/eventing/webhook-delivery.pipeline.ts:105` | past the early build |
| retention       | `≈ input.retention`               | –                                                                                       | `src/eventing/webhook-delivery.pipeline.ts:84`  | always               |
| lane aliases    | `≈ MAIN_DELIVERY_MANAGER_ALIASES` | –                                                                                       | `src/eventing/webhook-delivery.pipeline.ts:106` | past the early build |

### Tasks

Run by the tasks process, before serve.

| Task                        | Class                         | Declared at                                      |
| --------------------------- | ----------------------------- | ------------------------------------------------ |
| `webhook-signature-vectors` | `WebhookSignatureVectorsTask` | `src/tasks/webhook-signature-vectors.task.ts:13` |

## Configuration

| Kind   | Leaf                         | Environment variable                        | Declared at                            |
| ------ | ---------------------------- | ------------------------------------------- | -------------------------------------- |
| config | `allowInsecureLocalUrls`     | `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS`          | `../contract/src/webhook.config.ts:10` |
| config | `allowAmbientAwsCredentials` | `WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS` | `../contract/src/webhook.config.ts:11` |
| config | `isSaas`                     | `IS_SAAS`                                   | `../contract/src/webhook.config.ts:13` |
| config | `outboundProxy`              | `HTTPS_PROXY`                               | `../contract/src/webhook.config.ts:15` |

<!-- readme:generated:end -->
