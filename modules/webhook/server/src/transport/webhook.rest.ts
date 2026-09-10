/**
 * `/api/webhooks/v1` - the organization-key REST door onto the outbound
 * webhook platform. Live since 2026-08, so every path/body/header/status/enum
 * below is a published contract. Each handler asks the Enterprise plan gate
 * itself, the same order the `webhookEndpoints.*` tRPC surface asks it in.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION, BadRequestError } from "@langwatch/api/rest";
import {
  WEBHOOK_EVENT_TYPES,
  webhookDestinationKindSchema,
  WebhookEventNotFoundError,
  WebhookApi,
  type SqsDestinationInput,
  type WebhookEndpointView,
} from "@langwatch/webhook-contract";
import { toStoredEnum, toWireEnum } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { z } from "zod";

// ── Wire enums ──────────────────────────────────────────────────────────
// Every enum this surface publishes and accepts is lower_snake_case, input
// AND output, with no dual-casing tolerance: the stored SCREAMING_SNAKE is
// Prisma's convention, not a contract, and `toWireEnum` / `toStoredEnum`
// translate at this seam in both directions.

const endpointStatusSchema = z.enum(["active", "disabled"]);

const deliveryControlsSchema = {
  max_batch_size: z.number().int().optional(),
  max_batch_delay_ms: z.number().int().optional(),
  max_in_flight: z.number().int().optional(),
};

const destinationKindSchema = webhookDestinationKindSchema;

/**
 * The queue half of a destination. Only the queue URL is ever required: the
 * credential fields select which of the three modes the endpoint runs in, and
 * which of them are allowed is the service's call, not this schema's.
 */
const sqsDestinationSchema = z.object({
  queue_url: z.string().min(1).max(2000),
  role_arn: z.string().min(1).max(2048).optional(),
  external_id: z.string().min(1).max(1224).optional(),
  access_key_id: z.string().min(1).max(128).optional(),
  secret_access_key: z.string().min(1).max(256).optional(),
});

/**
 * Each kind requires its own address and refuses both at once (an endpoint
 * stores one); a superRefine puts the 400's message on the offending field.
 */
function refineDestinationShape(
  body: {
    destination_kind?: "http" | "sqs";
    url?: string;
    sqs?: { queue_url: string };
  },
  ctx: z.RefinementCtx,
): void {
  const kind = body.destination_kind ?? "http";
  if (kind === "http" && !body.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message: "url is required when destination_kind is http",
    });
  }
  if (kind === "http" && body.sqs !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sqs"],
      message:
        "sqs does not apply when destination_kind is http; remove it, or set destination_kind to sqs",
    });
  }
  if (kind === "sqs" && !body.sqs?.queue_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sqs", "queue_url"],
      message: "sqs.queue_url is required when destination_kind is sqs",
    });
  }
  if (kind === "sqs" && body.url !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message:
        "url does not apply when destination_kind is sqs; the queue URL goes in sqs.queue_url",
    });
  }
}

const createEndpointSchema = z
  .object({
    /** Absent means http, which is what every endpoint was before there was
     *  more than one kind. */
    destination_kind: destinationKindSchema.optional(),
    url: z.string().min(1).max(2000).optional(),
    sqs: sqsDestinationSchema.optional(),
    enabled_events: z.array(z.string().min(1).max(200)).min(1).max(100),
    ...deliveryControlsSchema,
  })
  .superRefine(refineDestinationShape);

const updateEndpointSchema = z.object({
  /** Accepted only when it repeats the kind the endpoint already has; the
   *  service refuses a change, because batches planned against the old
   *  transport are already in the outbox. */
  destination_kind: destinationKindSchema.optional(),
  url: z.string().min(1).max(2000).optional(),
  sqs: sqsDestinationSchema.partial().optional(),
  enabled_events: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  status: endpointStatusSchema.optional(),
  ...deliveryControlsSchema,
});

const deliveriesQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

const eventsQuerySchema = z
  .object({
    type: z.string().min(1).max(200).optional(),
    // The events log is a RANGED read by contract, the same contract the
    // spend-events pull carries and over the same table: without bounds the
    // walk sorts the whole 13-month table under FINAL on every page.
    from: z.coerce.number().int().positive().safe(),
    to: z.coerce.number().int().positive().safe(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

const endpointIdParams = z.object({ id: z.string().min(1) });

function endpointResponse(endpoint: WebhookEndpointView) {
  return {
    id: endpoint.id,
    destination_kind: endpoint.destinationKind,
    /** Null on every endpoint that is not an HTTPS one. */
    url: endpoint.url,
    sqs: endpoint.sqs
      ? {
          queue_url: endpoint.sqs.queueUrl,
          region: endpoint.sqs.region,
          account_id: endpoint.sqs.accountId,
          queue_name: endpoint.sqs.queueName,
          credential_mode: endpoint.sqs.credentialMode,
          role_arn: endpoint.sqs.roleArn,
          external_id: endpoint.sqs.externalId,
          access_key_id: endpoint.sqs.accessKeyId,
        }
      : null,
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
}

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// {@link endpointResponse} is the one builder behind create, list, get,
// patch and roll-secret, so one schema describes all five.

const sqsDestinationDtoSchema = z.object({
  queue_url: z.string(),
  region: z.string(),
  account_id: z.string(),
  queue_name: z.string(),
  credential_mode: z.enum(["assume_role", "static", "ambient"]),
  role_arn: z.string().nullable(),
  external_id: z.string().nullable(),
  access_key_id: z.string().nullable(),
});

const endpointCommonDtoFields = {
  id: z.string(),
  enabled_events: z.array(z.string()),
  status: endpointStatusSchema,
  disabled_reason: z.string().nullable(),
  disabled_at: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  max_batch_size: z.number().int(),
  max_batch_delay_ms: z.number().int(),
  max_in_flight: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
};

const httpEndpointDtoSchema = z.object({
  destination_kind: z.literal("http"),
  url: z.string(),
  sqs: z.null(),
  ...endpointCommonDtoFields,
});

const sqsEndpointDtoSchema = z.object({
  destination_kind: z.literal("sqs"),
  url: z.null(),
  sqs: sqsDestinationDtoSchema,
  ...endpointCommonDtoFields,
});

const endpointDtoSchema = z.discriminatedUnion("destination_kind", [
  httpEndpointDtoSchema,
  sqsEndpointDtoSchema,
]);

const endpointWithSecretDtoSchema = z.discriminatedUnion("destination_kind", [
  httpEndpointDtoSchema.extend({ secret: z.string() }),
  sqsEndpointDtoSchema.extend({ secret: z.string() }),
]);

const deliveryDtoSchema = z.object({
  id: z.string(),
  dispatch_id: z.string(),
  attempt: z.number().int(),
  event_count: z.number().int(),
  outcome: z.enum(["success", "retryable", "terminal", "pending"]),
  response_status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  fired_at: z.string(),
});

const healthDtoSchema = z.object({
  status: endpointStatusSchema,
  disabled_reason: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  oldest_undelivered_age_ms: z.number().int().nullable(),
  dlq_depth: z.number().int(),
  sends_per_minute: z.number(),
  success_rate: z.number().nullable(),
  p95_latency_ms: z.number().int().nullable(),
});

const eventTypeDtoSchema = z.object({
  type: z.string(),
  family: z.string(),
  schema_version: z.string(),
  is_emitting: z.boolean(),
  description: z.string(),
});

const webhookEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const testFireResultSchema = z.object({
  delivered: z.boolean(),
  response_status: z.number().int().nullable(),
  response_body: z.string().optional(),
  error: z.string().optional(),
});

const nextCursorSchema = z
  .string()
  .nullable()
  .describe(
    "Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page does NOT mean there is more.",
  );

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
function deliveriesCursorOf(cursor: string | undefined): { firedAt: Instant; id: string } | undefined {
  if (!cursor) return undefined;
  const [firedAtMs, cursorId] = cursor.split("~");
  const parsedMs = Number(firedAtMs);
  if (!Number.isInteger(parsedMs) || !cursorId) {
    throw new BadRequestError("invalid cursor");
  }
  return { firedAt: Temporal.Instant.fromEpochMilliseconds(parsedMs), id: cursorId };
}

export const webhookRest = defineRestRouter(WebhookApi)
  .withNamespace("webhooks")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // The generation is the contract: `/api/webhooks/v1` has been live since
  // 2026-08, so it answers exactly where it answers today, names its own
  // generation in the path and so has no `/api/v1` twin to declare.
  .withAddressing("v1-in-path")

  .post("/endpoints", "createWebhookEndpoint")
  .withInput(createEndpointSchema)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointWithSecretDtoSchema)
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

    return { ...endpointResponse(endpoint), secret };
  })

  .get("/endpoints", "listWebhookEndpoints")
  .withPermission("webhookEndpoints:view")
  .withOutput(z.array(endpointDtoSchema))
  .withDocs({
    tags: ["Webhooks"],
    summary: "List webhook endpoints",
    description: "List the organization's webhook endpoints",
  })
  .handle(async ({ app, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const list = await app.getAll({ organizationId: scope.id });
    return list.map(endpointResponse);
  })

  .get("/endpoints/:id", "getWebhookEndpoint")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:view")
  .withOutput(endpointDtoSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Get a webhook endpoint",
    description: "Get one webhook endpoint",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const endpoint = await app.getById({ organizationId: scope.id, endpointId: input.id });
    return endpointResponse(endpoint);
  })

  .patch("/endpoints/:id", "updateWebhookEndpoint")
  .withParams(endpointIdParams)
  .withInput(updateEndpointSchema)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointDtoSchema)
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

    return endpointResponse(endpoint);
  })

  .delete("/endpoints/:id", "archiveWebhookEndpoint")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:manage")
  .withOutput(z.object({ archived: z.literal(true) }))
  .withDocs({
    tags: ["Webhooks"],
    summary: "Archive a webhook endpoint",
    description: "Archive a webhook endpoint",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    await app.archive({ organizationId: scope.id, endpointId: input.id });
    return { archived: true as const };
  })

  .post("/endpoints/:id/roll-secret", "rollWebhookEndpointSecret")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:manage")
  .withOutput(endpointWithSecretDtoSchema)
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
    return { ...endpointResponse(endpoint), secret };
  })

  .post("/endpoints/:id/test", "testWebhookEndpoint")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:manage")
  .withOutput(testFireResultSchema)
  .withDocs({
    tags: ["Webhooks"],
    summary: "Send a test event to an endpoint",
    description:
      "Send a signed test event through the full delivery path. Contract: the route answers 200 whenever the test itself ran; delivered says whether the receiver accepted it, so clients must read the body, not the status code.",
  })
  .handle(async ({ app, input, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    const result = await app.testFire({ organizationId: scope.id, endpointId: input.id });

    return result.delivered
      ? { delivered: true, response_status: result.responseStatus, response_body: result.responseBody }
      : { delivered: false, response_status: result.responseStatus, error: result.error };
  })

  .get("/endpoints/:id/deliveries", "listWebhookEndpointDeliveries")
  .withParams(endpointIdParams)
  .withQuery(deliveriesQuerySchema)
  .withPermission("webhookEndpoints:view")
  .withOutput(z.object({ data: z.array(deliveryDtoSchema), next_cursor: nextCursorSchema }))
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
      cursor: deliveriesCursorOf(input.cursor),
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

  .get("/endpoints/:id/health", "getWebhookEndpointHealth")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:view")
  .withOutput(healthDtoSchema)
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
    };
  })

  .get("/event-types", "listWebhookEventTypes")
  .withPermission("webhookEndpoints:view")
  .withOutput(z.array(eventTypeDtoSchema))
  .withDocs({
    tags: ["Webhooks"],
    summary: "List subscribable event types",
    description:
      "The event catalog: every subscribable type, grouped by family; types marked emitting=false are declared contracts whose producers have not shipped yet",
  })
  .handle(async ({ app, scope }) => {
    await app.assertEndpointsEntitled(scope.id);

    return WEBHOOK_EVENT_TYPES.map((t) => ({
      type: t.type,
      family: t.family,
      schema_version: t.schemaVersion,
      is_emitting: t.isEmitting,
      description: t.description,
    }));
  })

  .get("/events", "listWebhookEvents")
  .withQuery(eventsQuerySchema)
  .withPermission("webhookEndpoints:view")
  .withOutput(z.object({ data: z.array(webhookEventEnvelopeSchema), next_cursor: nextCursorSchema }))
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

  .get("/events/:id", "getWebhookEvent")
  .withParams(endpointIdParams)
  .withPermission("webhookEndpoints:view")
  .withOutput(webhookEventEnvelopeSchema)
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
    return event;
  })

  .build();
