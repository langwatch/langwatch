import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  BadRequestError,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { toStoredEnum, toWireEnum } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";
import {
  WEBHOOK_EVENT_TYPES,
  WebhookEventNotFoundError,
  WebhookApi,
  type SqsDestinationInput,
  type WebhookEndpointView,
  deliveryListResponseSchema,
  endpointArchivedResponseSchema,
  endpointListResponseSchema,
  endpointResponseSchema,
  endpointWithSecretResponseSchema,
  eventTypeListResponseSchema,
  webhookEventResponseSchema,
  webhookEventListResponseSchema,
  createEndpointSchema,
  updateEndpointSchema,
  deliveriesQuerySchema,
  eventsQuerySchema,
  healthResponseSchema,
  testFireResponseSchema,
  rollEndpointSecretBodySchema,
  testEndpointBodySchema,
} from "@langwatch/webhook-contract";
import { z } from "zod";

// ── Wire enums ──────────────────────────────────────────────────────────
// Every enum this surface publishes and accepts is lower_snake_case, input
// AND output, with no dual-casing tolerance: the stored SCREAMING_SNAKE is
// Prisma's convention, not a contract, and `toWireEnum` / `toStoredEnum`
// translate at this seam in both directions.

const endpointIdParams = z.object({ id: z.string().min(1) });

function endpointResponse(endpoint: WebhookEndpointView) {
  const common = {
    id: endpoint.id,
    enabled_events: endpoint.enabledEvents,
    status: toWireEnum(endpoint.status),
    disabled_reason: endpoint.disabledReason,
    disabled_at: endpoint.disabledAt?.toISOString() ?? null,
    failing_since: endpoint.failingSince?.toISOString() ?? null,
    last_success_at: endpoint.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: endpoint.lastFailureAt?.toISOString() ?? null,
    max_batch_size: endpoint.maxBatchSize,
    max_batch_delay_ms: endpoint.maxBatchDelayMs,
    max_in_flight: endpoint.maxInFlight,
    created_at: endpoint.createdAt.toISOString(),
    updated_at: endpoint.updatedAt.toISOString(),
  };

  if (endpoint.destinationKind === "sqs") {
    if (!endpoint.sqs) {
      throw new Error(`sqs endpoint ${endpoint.id} is missing its sqs destination`);
    }
    return {
      ...common,
      destination_kind: "sqs" as const,
      url: null,
      sqs: {
        queue_url: endpoint.sqs.queueUrl,
        region: endpoint.sqs.region,
        account_id: endpoint.sqs.accountId,
        queue_name: endpoint.sqs.queueName,
        credential_mode: endpoint.sqs.credentialMode,
        role_arn: endpoint.sqs.roleArn,
        external_id: endpoint.sqs.externalId,
        access_key_id: endpoint.sqs.accessKeyId,
      },
    };
  }

  if (!endpoint.url) {
    throw new Error(`http endpoint ${endpoint.id} is missing its url`);
  }
  return {
    ...common,
    destination_kind: "http" as const,
    url: endpoint.url,
    sqs: null,
  };
}

/** The queue fields, wire spelling to service spelling. */
function sqsFromBody(sqs: {
  queue_url?: string;
  role_arn?: string;
  external_id?: string;
  access_key_id?: string;
  secret_access_key?: string;
}) {
  return {
    ...(sqs.queue_url !== undefined ? { queueUrl: sqs.queue_url } : {}),
    ...(sqs.role_arn !== undefined ? { roleArn: sqs.role_arn } : {}),
    ...(sqs.external_id !== undefined ? { externalId: sqs.external_id } : {}),
    ...(sqs.access_key_id !== undefined ? { accessKeyId: sqs.access_key_id } : {}),
    ...(sqs.secret_access_key !== undefined ? { secretAccessKey: sqs.secret_access_key } : {}),
  };
}

/**
 * The destination half of a create body, wire to service spelling, stated by
 * narrowing the parameter rather than casting - the schema already refused
 * a kind with no address.
 */
function destinationFromBody(body: {
  destination_kind?: "http" | "sqs";
  url?: string;
  sqs?: { queue_url: string };
}):
  | { destinationKind: "http"; url: string | undefined }
  | { destinationKind: "sqs"; sqs: SqsDestinationInput } {
  if ((body.destination_kind ?? "http") !== "sqs") {
    return { destinationKind: "http", url: body.url };
  }
  const sqs = body.sqs;
  if (!sqs?.queue_url) {
    // Unreachable through the route, whose schema refuses this body. Saying so
    // out loud beats a cast that would quietly write an empty queue URL.
    throw new BadRequestError("sqs.queue_url is required for an sqs endpoint");
  }
  return {
    destinationKind: "sqs",
    sqs: { ...sqsFromBody(sqs), queueUrl: sqs.queue_url },
  };
}

/** The `firedAt~id` wire cursor, parsed into the position the service reads. */
function parseDeliveriesCursor(
  cursor: string | undefined,
): { firedAt: Instant; id: string } | undefined {
  if (!cursor) return undefined;
  const [firedAtMs, cursorId] = cursor.split("~");
  const parsedMs = Number(firedAtMs);
  if (!Number.isInteger(parsedMs) || !cursorId) {
    throw new BadRequestError("invalid cursor");
  }
  return { firedAt: Temporal.Instant.fromEpochMilliseconds(parsedMs), id: cursorId };
}

export const webhookRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<WebhookApi>;
}> = defineRestRouter(WebhookApi)
  .withNamespace("webhooks")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // The generation is the contract: `/api/webhooks/v1` has been live since
  // 2026-08, so it answers exactly where it answers today, names its own
  // generation in the path and so has no `/api/v1` twin to declare.
  .withAddressing("v1-in-path")

  .post("/endpoints", "postApiWebhooksV1Endpoints")
  .withInput(createEndpointSchema)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointWithSecretResponseSchema)
  .withStatus(201)
  // Scoped to the organization, not a project: this family authenticates at
  // the org, so that is the tenancy a key is unique within. A replay of a
  // lost create is the only way to recover its secret.
  .withIdempotency({ operation: "webhooks.v1.endpoints.create" })
  .withDocs({
    tags: ["Webhooks"],
    summary: "Create a webhook endpoint",
    description:
      "Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including its `secret`, which is the only way to recover a secret whose response was lost in transit.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const { endpoint, secret } = await app.create({
      organizationId: scope.id,
      ...destinationFromBody(input),
      enabledEvents: input.enabled_events,
      maxBatchSize: input.max_batch_size,
      maxBatchDelayMs: input.max_batch_delay_ms,
      maxInFlight: input.max_in_flight,
    });

    return { data: { ...endpointResponse(endpoint), secret } };
  })

  .get("/endpoints", "getApiWebhooksV1Endpoints")
  .withPermission("webhookEndpoints:view")
  .withOutput(endpointListResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "List webhook endpoints",
    description: "List the organization's webhook endpoints",
  })
  .handle(async ({ app, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const list = await app.getAll({ organizationId: scope.id });
    return { data: list.map(endpointResponse) };
  })

  .get("/endpoints/:id", "getApiWebhooksV1EndpointsById")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:view")
  .withOutput(endpointResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Get a webhook endpoint",
    description: "Get one webhook endpoint",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const endpoint = await app.getById({ organizationId: scope.id, endpointId: input.id });
    return { data: endpointResponse(endpoint) };
  })

  .patch("/endpoints/:id", "patchApiWebhooksV1EndpointsById")
  .withParams(endpointIdParams)
  .withInput(updateEndpointSchema)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Update a webhook endpoint",
    description:
      "Update a webhook endpoint's address, event subscriptions, or status (`active` re-enables, `disabled` pauses; re-enabling does not re-send the gap, replay covers it). `destination_kind` cannot change: batches already planned against the old transport are in flight, so a move means a new endpoint alongside this one until it has drained.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const endpointId = input.id;
    const hasFieldUpdate =
      input.destination_kind !== undefined ||
      input.url !== undefined ||
      input.sqs !== undefined ||
      input.enabled_events !== undefined ||
      input.max_batch_size !== undefined ||
      input.max_batch_delay_ms !== undefined ||
      input.max_in_flight !== undefined;

    let endpoint = hasFieldUpdate
      ? await app.update({
          organizationId: scope.id,
          endpointId,
          destinationKind: input.destination_kind,
          url: input.url,
          ...(input.sqs !== undefined ? { sqs: sqsFromBody(input.sqs) } : {}),
          enabledEvents: input.enabled_events,
          maxBatchSize: input.max_batch_size,
          maxBatchDelayMs: input.max_batch_delay_ms,
          maxInFlight: input.max_in_flight,
        })
      : await app.getById({ organizationId: scope.id, endpointId });

    const requestedStatus = input.status && toStoredEnum(input.status);
    if (requestedStatus === "DISABLED" && endpoint.status === "ACTIVE") {
      endpoint = await app.disable({ organizationId: scope.id, endpointId });
    } else if (requestedStatus === "ACTIVE" && endpoint.status === "DISABLED") {
      endpoint = await app.enable({ organizationId: scope.id, endpointId });
    }

    return { data: endpointResponse(endpoint) };
  })

  .delete("/endpoints/:id", "deleteApiWebhooksV1EndpointsById")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointArchivedResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Archive a webhook endpoint",
    description: "Archive a webhook endpoint",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    await app.archive({ organizationId: scope.id, endpointId: input.id });
    return { data: { archived: true as const } };
  })

  .post("/endpoints/:id/roll-secret", "postApiWebhooksV1EndpointsByIdRollSecret")
  .withParams(endpointIdParams)
  .withInput(rollEndpointSecretBodySchema)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointWithSecretResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Roll an endpoint's signing secret",
    description:
      "Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it immediately.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const { endpoint, secret } = await app.rollSecret({
      organizationId: scope.id,
      endpointId: input.id,
    });
    return { data: { ...endpointResponse(endpoint), secret } };
  })

  .post("/endpoints/:id/test", "postApiWebhooksV1EndpointsByIdTest")
  .withParams(endpointIdParams)
  .withInput(testEndpointBodySchema)
  .withPermission("webhookEndpoints:manage")
  .withOutput(testFireResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Send a test event to an endpoint",
    description:
      "Send a signed test event through the full delivery path. Contract: the route answers 200 whenever the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the body, not the status code.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const result = await app.testFire({ organizationId: scope.id, endpointId: input.id });

    return {
      data: result.delivered
        ? {
            delivered: true,
            response_status: result.responseStatus,
            response_body: result.responseBody,
          }
        : { delivered: false, response_status: result.responseStatus, error: result.error },
    };
  })

  .get("/endpoints/:id/deliveries", "getApiWebhooksV1EndpointsByIdDeliveries")
  .withParams(endpointIdParams)
  .withQuery(deliveriesQuerySchema)
  .withPermission("webhookEndpoints:view")
  .withOutput(deliveryListResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "List an endpoint's delivery attempts",
    description:
      "The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const page = await app.getDeliveries({
      organizationId: scope.id,
      endpointId: input.id,
      limit: input.limit,
      cursor: parseDeliveriesCursor(input.cursor),
    });

    return {
      next_cursor: page.nextCursor
        ? `${page.nextCursor.firedAt.epochMilliseconds}~${page.nextCursor.id}`
        : null,
      data: page.deliveries.map((r) => ({
        id: r.id,
        dispatch_id: r.dispatchId,
        attempt: r.attempt,
        event_count: r.eventCount,
        outcome: r.outcome,
        response_status: r.responseStatus,
        latency_ms: r.latencyMs,
        error: r.error,
        fired_at: r.firedAt.toString({ fractionalSecondDigits: 3 }),
      })),
    };
  })

  .get("/endpoints/:id/health", "getApiWebhooksV1EndpointsByIdHealth")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:view")
  .withOutput(healthResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Read an endpoint's delivery health",
    description:
      "Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success rate, and p95 latency over the last hour.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const report = await app.getHealth({ organizationId: scope.id, endpointId: input.id });
    return {
      data: {
        status: toWireEnum(report.status),
        disabled_reason: report.disabledReason,
        failing_since: report.failingSince?.toISOString() ?? null,
        last_success_at: report.lastSuccessAt?.toISOString() ?? null,
        last_failure_at: report.lastFailureAt?.toISOString() ?? null,
        oldest_undelivered_age_ms: report.oldestUndeliveredAgeMs,
        dlq_depth: report.dlqDepth,
        sends_per_minute: report.sendsPerMinute,
        success_rate: report.successRate,
        p95_latency_ms: report.p95LatencyMs,
      },
    };
  })

  .get("/event-types", "getApiWebhooksV1EventTypes")
  .withPermission("webhookEndpoints:view")
  .withOutput(eventTypeListResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "List subscribable event types",
    description:
      "The event catalog: every subscribable type, grouped by family; types marked emitting=false are declared contracts whose producers have not shipped yet",
  })
  .handle(async ({ app, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    return {
      data: WEBHOOK_EVENT_TYPES.map((t) => ({
        type: t.type,
        family: t.family,
        schema_version: t.schemaVersion,
        is_emitting: t.isEmitting,
        description: t.description,
      })),
    };
  })

  .get("/events", "getApiWebhooksV1Events")
  .withQuery(eventsQuerySchema)
  .withPermission("webhookEndpoints:view")
  .withOutput(webhookEventListResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "List emitted events",
    description:
      "The organization's emitted-events log for the request families: cursor-paged, newest first, filter by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from` must not be later than `to` - a range that ends before it starts is rejected rather than answered with an empty page. They are required because the log is a ranged read over the 13-month spend table and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page rather than an error, so a client can probe forward-compatibly.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    // The service maps emitted types to row statuses and serves an empty page
    // for unknown types, so consumers can probe forward-compatibly without an
    // error.
    const page = await app.getEmittedEvents({
      organizationId: scope.id,
      fromMs: input.from,
      toMs: input.to,
      cursor: input.cursor ?? null,
      limit: input.limit,
      types: input.type !== undefined ? [input.type] : undefined,
    });

    return { data: page.events, next_cursor: page.nextCursor };
  })

  .get("/events/:id", "getApiWebhooksV1EventsById")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:view")
  .withOutput(webhookEventResponseSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Get one emitted event",
    description:
      "One emitted event by its id, as it was delivered. Serves the same families the events log serves. A 404 covers every reason the log cannot answer -- never emitted, past the retention horizon, or belonging to another organization -- because telling those apart would confirm the existence of another tenant's request ids.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const event = await app.findEmittedEventById({ organizationId: scope.id, id: input.id });
    if (!event) throw new WebhookEventNotFoundError();
    return { data: event };
  })

  .build();
