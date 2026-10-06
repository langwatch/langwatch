# @langwatch/webhook-process

The server half of [webhook](../README.md). Webhook endpoints: creating and managing them, signing secrets, and delivering events to them with a delivery log and health per endpoint.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("webhook").withRepositories(webhookRepositories).withApi(WebhookModule).withTransports(webhookEndpointTrpcTransport, webhookRest, webhookSpendReplayRest).withEventing(webhookDeliveryEventing)`, `src/webhook.module.ts:15`.

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
type Body = z.infer<typeof webhookSpendReplayBodySchema>; // ../contract/src/webhook-spend-replay.schemas.ts:14
type Response = z.infer<typeof webhookSpendReplayResponseSchema>; // ../contract/src/webhook-spend-replay.schemas.ts:35
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

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:190`.

Answers at `/api/webhooks/v1/endpoints`.

```typescript
type Response = z.infer<typeof endpointListResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:102
```

#### `GET /endpoints/:id` · `getApiWebhooksV1EndpointsById`

Get a webhook endpoint

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:205`.

Answers at `/api/webhooks/v1/endpoints/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Response = z.infer<typeof endpointResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:122
```

#### `PATCH /endpoints/:id` · `patchApiWebhooksV1EndpointsById`

Update a webhook endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:221`.

Answers at `/api/webhooks/v1/endpoints/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Body = z.infer<typeof updateEndpointSchema>; // ../contract/src/webhook-rest.schemas.ts:211
type Response = z.infer<typeof endpointResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:122
```

#### `DELETE /endpoints/:id` · `deleteApiWebhooksV1EndpointsById`

Archive a webhook endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:251`.

Answers at `/api/webhooks/v1/endpoints/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Response = z.infer<typeof endpointArchivedResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:126
```

#### `POST /endpoints/:id/roll-secret` · `postApiWebhooksV1EndpointsByIdRollSecret`

Roll an endpoint's signing secret

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:267`.

Answers at `/api/webhooks/v1/endpoints/:id/roll-secret`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Body = z.infer<typeof rollEndpointSecretBodySchema>; // ../contract/src/webhook-rest.schemas.ts:273
type Response = z.infer<typeof endpointWithSecretResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:124
```

#### `POST /endpoints/:id/test` · `postApiWebhooksV1EndpointsByIdTest`

Send a test event to an endpoint

Permission `webhookEndpoints:manage`. Declared at `src/transport/webhook.rest.ts:288`.

Answers at `/api/webhooks/v1/endpoints/:id/test`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Body = z.infer<typeof testEndpointBodySchema>; // ../contract/src/webhook-rest.schemas.ts:276
type Response = z.infer<typeof testFireResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:270
```

#### `GET /endpoints/:id/deliveries` · `getApiWebhooksV1EndpointsByIdDeliveries`

List an endpoint's delivery attempts

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:320`.

Answers at `/api/webhooks/v1/endpoints/:id/deliveries`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Query = z.infer<typeof deliveriesQuerySchema>; // ../contract/src/webhook-rest.schemas.ts:224
type Response = z.infer<typeof deliveryListResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:110
```

#### `GET /endpoints/:id/health` · `getApiWebhooksV1EndpointsByIdHealth`

Read an endpoint's delivery health

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:359`.

Answers at `/api/webhooks/v1/endpoints/:id/health`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Response = z.infer<typeof healthResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:268
```

#### `GET /event-types` · `getApiWebhooksV1EventTypes`

List subscribable event types

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:389`.

Answers at `/api/webhooks/v1/event-types`.

```typescript
type Response = z.infer<typeof eventTypeListResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:106
```

#### `GET /events` · `getApiWebhooksV1Events`

List emitted events

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:412`.

Answers at `/api/webhooks/v1/events`.

```typescript
type Query = z.infer<typeof eventsQuerySchema>; // ../contract/src/webhook-rest.schemas.ts:229
type Response = z.infer<typeof webhookEventListResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:115
```

#### `GET /events/:id` · `getApiWebhooksV1EventsById`

Get one emitted event

Permission `webhookEndpoints:view`. Declared at `src/transport/webhook.rest.ts:440`.

Answers at `/api/webhooks/v1/events/:id`.

```typescript
type Params = z.infer<typeof endpointIdParams>; // src/transport/webhook.rest.ts:39
type Response = z.infer<typeof webhookEventResponseSchema>; // ../contract/src/webhook-rest.schemas.ts:130
```

## tRPC transport

### `webhookEndpoints`

Contract `../contract/src/webhook-endpoint.trpc.ts:72`, router `src/transport/webhook-endpoint.trpc.ts:13`.

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

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `webhook_delivery` (aggregate `webhook_spend_delivery`)

Declared at `src/eventing/webhook-delivery.pipeline.ts:51`. Events: `webhookSpendDeliveryRequestedEventSchema`, `webhookGovernanceDeliveryRequestedEventSchema`.

The chain builds early when `!input.deliveryProcess || !input.governanceProcess || !input.gatewayEvents` (`src/eventing/webhook-delivery.pipeline.ts:61`); the rows built only past that return say so. The caller's arguments decide which role gets which build.

| Kind            | Name                            | Handles                                                                 | Declared at                                    | Built                |
| --------------- | ------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- | -------------------- |
| command         | `requestSpendDelivery`          | –                                                                       | `src/eventing/webhook-delivery.pipeline.ts:59` | always               |
| command         | `requestGovernanceDelivery`     | –                                                                       | `src/eventing/webhook-delivery.pipeline.ts:60` | always               |
| process manager | `webhookDelivery`               | ≈ applier `input.deliveryProcess`                                       | `src/eventing/webhook-delivery.pipeline.ts:66` | past the early build |
| process manager | `governanceEventsDelivery`      | ≈ applier `input.governanceProcess`                                     | `src/eventing/webhook-delivery.pipeline.ts:67` | past the early build |
| peer subscriber | `gatewaySpendAdmittedDelivery`  | `lw.gateway.spend.admitted` from [gateway](../../gateway/README.md)     | `src/eventing/webhook-delivery.pipeline.ts:68` | past the early build |
| peer subscriber | `gatewaySpendConfirmedDelivery` | `lw.gateway.spend.confirmed` from [gateway](../../gateway/README.md)    | `src/eventing/webhook-delivery.pipeline.ts:69` | past the early build |
| peer subscriber | `gatewaySpendFailedDelivery`    | `lw.gateway.spend.failed` from [gateway](../../gateway/README.md)       | `src/eventing/webhook-delivery.pipeline.ts:70` | past the early build |
| peer subscriber | `gatewaySpendSettledDelivery`   | `lw.gateway.spend.settled` from [gateway](../../gateway/README.md)      | `src/eventing/webhook-delivery.pipeline.ts:71` | past the early build |
| peer subscriber | `gatewayBudgetCrossingDelivery` | `lw.governance.budget_crossing` from [gateway](../../gateway/README.md) | `src/eventing/webhook-delivery.pipeline.ts:72` | past the early build |
| peer subscriber | `gatewayVkLifecycleDelivery`    | `lw.governance.vk_lifecycle` from [gateway](../../gateway/README.md)    | `src/eventing/webhook-delivery.pipeline.ts:73` | past the early build |

## Configuration

| Kind   | Leaf                         | Environment variable                        | Declared at                            |
| ------ | ---------------------------- | ------------------------------------------- | -------------------------------------- |
| config | `allowInsecureLocalUrls`     | `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS`          | `../contract/src/webhook.config.ts:13` |
| config | `allowAmbientAwsCredentials` | `WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS` | `../contract/src/webhook.config.ts:14` |
| config | `isSaas`                     | `IS_SAAS`                                   | `../contract/src/webhook.config.ts:16` |
| config | `outboundProxy`              | `HTTPS_PROXY`                               | `../contract/src/webhook.config.ts:18` |

<!-- readme:generated:end -->
