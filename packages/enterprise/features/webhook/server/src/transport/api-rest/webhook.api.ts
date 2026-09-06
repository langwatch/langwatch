import { randomUUID } from "node:crypto";

import { requires } from "@langwatch/api";
import {
  type ApiErrorBody,
  apiErrorSchema,
  type AppRestSecurity,
  BadRequestError,
  canonicalBaseResponses,
  canonicalConflictResponses,
  createCanonicalFamilyErrorHandler,
  ForbiddenError,
  idempotentReplayHeaders,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type OrganizationScopedContext,
  organizationOf,
  resolver,
  type EndpointVariables,
} from "@langwatch/api/rest";
import {
  WEBHOOK_EVENT_TYPES,
  webhookDestinationKindSchema,
  WEBHOOK_ENDPOINTS_NOT_ENTITLED_CODE,
  WebhookEventNotFoundError,
  type SqsDestinationInput,
  type WebhookEndpointView,
} from "@langwatch/enterprise-webhook-contract";
import { toStoredEnum, toWireEnum } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { WebhookApp } from "#app/webhook.app";
import type { WebhookEndpointRuntime } from "../../adapters/webhook-endpoint.webhook-endpoint.adapter";

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
  /** Read off the queue URL, never configured beside it. */
  region: z.string(),
  /** Whose queue this is. Surfaced so an operator can see it without
   *  decoding a URL by eye. */
  account_id: z.string(),
  queue_name: z.string(),
  /** `assume_role` when a role is named, `static` when a key pair is stored,
   *  `ambient` when the deployment's own identity is used, which needs an
   *  operator opt-in. */
  credential_mode: z.enum(["assume_role", "static", "ambient"]),
  role_arn: z.string().nullable(),
  /** Generated at save time, to paste into the role's trust policy. */
  external_id: z.string().nullable(),
  /** The key id only. The secret half is never returned. */
  access_key_id: z.string().nullable(),
});

/** Everything an endpoint carries that is not its destination. */
const endpointCommonDtoFields = {
  id: z.string(),
  enabled_events: z.array(z.string()),
  status: endpointStatusSchema,
  /** `manual` when an operator paused it, `auto_failures_72h` when the
   *  failure ladder did. Null while the endpoint is active. */
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

/**
 * A union on `destination_kind`, not two nullable fields: those permitted
 * `destination_kind: "http"` beside a populated `sqs`, forcing a client to
 * null-check both and hope.
 */
const httpEndpointDtoSchema = z.object({
  destination_kind: z.literal("http"),
  /** The receiver URL. An http endpoint always has one. */
  url: z.string(),
  sqs: z.null(),
  ...endpointCommonDtoFields,
});

const sqsEndpointDtoSchema = z.object({
  destination_kind: z.literal("sqs"),
  url: z.null(),
  /** The queue this endpoint delivers to. */
  sqs: sqsDestinationDtoSchema,
  ...endpointCommonDtoFields,
});

const endpointDtoSchema = z.discriminatedUnion("destination_kind", [
  httpEndpointDtoSchema,
  sqsEndpointDtoSchema,
]);

/**
 * The endpoint plus its plaintext signing secret. Create and roll-secret are
 * the only two responses that carry it; every read serves
 * {@link endpointDtoSchema}, which has no `secret` field to be absent from.
 */
const endpointWithSecretDtoSchema = z.discriminatedUnion("destination_kind", [
  httpEndpointDtoSchema.extend({ secret: z.string() }),
  sqsEndpointDtoSchema.extend({ secret: z.string() }),
]);

const deliveryDtoSchema = z.object({
  id: z.string(),
  /** The send this attempt belongs to; retries of one batch share it. */
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
  /** Null when everything produced has been delivered. */
  oldest_undelivered_age_ms: z.number().int().nullable(),
  dlq_depth: z.number().int(),
  sends_per_minute: z.number(),
  /** Delivered over attempted in the last hour; null with no attempts. */
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

/**
 * One emitted event, the same envelope signed deliveries carry. `data` stays
 * an open object since every family carries its own cut of the payload.
 */
const webhookEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/**
 * A test fire's outcome. `response_body` carries the receiver's answer,
 * truncated, when one arrived; `error` replaces it with `response_status`
 * null when the delivery never reached a receiver at all.
 */
const testFireResultSchema = z.object({
  delivered: z.boolean(),
  response_status: z.number().int().nullable(),
  response_body: z.string().optional(),
  error: z.string().optional(),
});

/** The paging half of every cursor-paged list on this surface. */
const nextCursorSchema = z
  .string()
  .nullable()
  .describe(
    "Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page does NOT mean there is more.",
  );

/** The refusal every route that names an endpoint or an event can answer. */
const notFoundResponse = {
  404: {
    description: "Not Found",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

const logger = createLogger("langwatch:webhooks:rest");

type WebhookContext = OrganizationScopedContext<EndpointVariables>;

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
 * narrowing the parameter rather than casting — the schema already refused
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

/** The single-envelope batch a test fire sends. */
function testFireBody(now: Date): string {
  return JSON.stringify({
    batch: [
      {
        id: `evt_test_${randomUUID()}`,
        type: "test.ping",
        created: now.toISOString(),
        schema_version: "1",
        data: { message: "LangWatch webhook test delivery" },
      },
    ],
  });
}

/** Record a test fire's outcome. The test itself ran, so a delivery-log
 *  hiccup must not convert the documented 200-with-result contract into a
 *  500. */
async function recordTestFire(
  endpoints: WebhookEndpointRuntime,
  attempt: {
    organizationId: string;
    endpointId: string;
    dispatchId: string;
    outcome: "success" | "terminal";
    responseStatus?: number;
    error?: string;
  },
): Promise<void> {
  try {
    await endpoints.recordDeliveryAttempt({
      ...attempt,
      attempt: 1,
      eventCount: 1,
    });
  } catch (logError) {
    logger.warn({ error: logError }, "test-fire delivery log write failed");
  }
}

/**
 * PATCH `/endpoints/:id`: applies any field update, then any requested
 * status transition on the possibly just-updated row. Pulled out of the
 * route table as the bulk of its cognitive complexity.
 */
async function updateEndpointHandler(
  webhooks: () => WebhookApp,
  input: { id: string } & z.infer<typeof updateEndpointSchema>,
  organization: { id: string },
) {
  const endpointId = input.id;
  const body = input;
  const endpoints = webhooks().endpoints;

  const hasFieldUpdate =
    body.destination_kind !== undefined ||
    body.url !== undefined ||
    body.sqs !== undefined ||
    body.enabled_events !== undefined ||
    body.max_batch_size !== undefined ||
    body.max_batch_delay_ms !== undefined ||
    body.max_in_flight !== undefined;
  let endpoint = hasFieldUpdate
    ? await endpoints.update({
        organizationId: organization.id,
        endpointId,
        destinationKind: body.destination_kind,
        url: body.url,
        ...(body.sqs !== undefined ? { sqs: sqsFromBody(body.sqs) } : {}),
        enabledEvents: body.enabled_events,
        maxBatchSize: body.max_batch_size,
        maxBatchDelayMs: body.max_batch_delay_ms,
        maxInFlight: body.max_in_flight,
      })
    : await endpoints.getById({
        organizationId: organization.id,
        endpointId,
      });
  const requestedStatus = body.status && toStoredEnum(body.status);
  if (requestedStatus === "DISABLED" && endpoint.status === "ACTIVE") {
    endpoint = await endpoints.disable({
      organizationId: organization.id,
      endpointId,
    });
  } else if (requestedStatus === "ACTIVE" && endpoint.status === "DISABLED") {
    endpoint = await endpoints.enable({
      organizationId: organization.id,
      endpointId,
    });
  }
  return { data: endpointResponse(endpoint) };
}

/**
 * POST `/endpoints/:id/test`: dispatches a signed test event and reports its
 * outcome, logging (never throwing) on a delivery-log write failure. Pulled
 * out of the route table as the other large share of its complexity.
 */
async function testEndpointHandler(
  webhooks: () => WebhookApp,
  input: { id: string },
  organization: { id: string },
) {
  const endpointId = input.id;
  const services = webhooks();
  const [secrets, destination] = await Promise.all([
    services.endpoints.getSigningSecrets({
      organizationId: organization.id,
      endpointId,
    }),
    services.endpoints.getDestinationConfig({
      organizationId: organization.id,
      endpointId,
    }),
  ]);
  const dispatchId = `test:${randomUUID()}`;
  try {
    // The test has to reach exactly what real delivery reaches, including
    // the transport: a queue endpoint's test must land on the queue, not
    // on a URL it does not have.
    const result = await services.dispatch({
      destination,
      organizationId: organization.id,
      endpointId,
      body: testFireBody(new Date()),
      batchId: dispatchId,
      attempt: 1,
      signingSecrets: secrets,
      isTestFire: true,
    });
    const delivered = result.verdict === "success";
    await recordTestFire(services.endpoints, {
      organizationId: organization.id,
      endpointId,
      dispatchId,
      outcome: delivered ? "success" : "terminal",
      ...(result.status !== null ? { responseStatus: result.status } : {}),
    });
    return {
      data: {
        delivered,
        // Null on a transport with no status of its own: a queue accepted
        // the message or it did not, and there is no code to report.
        response_status: result.status,
        // `body` is `unknown` on the dispatch result — a queue transport
        // answers with whatever its client returned — so it is rendered
        // rather than sliced directly, which would throw on a non-string.
        response_body: String(delivered ? (result.body ?? "") : (result.error ?? "")).slice(0, 500),
      },
    };
  } catch (error) {
    // The full message goes to the delivery log for the operator; the
    // response carries a sanitized summary so internal dispatch wording
    // and transport details never reach the caller verbatim.
    await recordTestFire(services.endpoints, {
      organizationId: organization.id,
      endpointId,
      dispatchId,
      outcome: "terminal",
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    });
    return {
      data: {
        delivered: false,
        response_status: null,
        error:
          "The test delivery could not reach the receiver; see the endpoint's delivery log for details.",
      },
    };
  }
}

/**
 * The webhook platform's public REST surface, `/api/webhooks/v1`. Live since
 * 2026-08, so every path/body/header/status/enum below is a published contract.
 */
export function createWebhookRestApp(options: {
  security: AppRestSecurity;
  /**
   * The feature's application, resolved per request. The SAME
   * {@link WebhookApp} the tRPC surface is given, so the entitlement gate and
   * the endpoint store cannot drift between the two doors.
   */
  webhooks: () => WebhookApp;
  /**
   * The application's canonical error mapping. Every refusal from this surface
   * leaves as that envelope; the family's own handler exists only to log it
   * under the family's name.
   */
  canonicalError: (
    error: unknown,
    c: Context<any>,
  ) => { status: ContentfulStatusCode; body: ApiErrorBody };
}): MountableRestApp {
  const { security, webhooks, canonicalError } = options;

  /**
   * Enterprise gate for the whole surface, delegating to the one shared
   * entitlement check. Runs after the org auth chain so the organization is
   * on the context.
   */
  const requireWebhookPlan = async (c: Context, next: Next): Promise<void> => {
    const organization = c.get("organization") as { id: string };
    try {
      await webhooks().assertEntitled(organization.id);
    } catch (error) {
      // On `code`, not `instanceof`: the gate is composed by the process, so
      // the refusal crosses a package boundary and an identity check answers
      // false whenever the two ends resolved the contract differently — which
      // would drop a named 403 to an unknown 500.
      if (HandledError.isHandled(error) && error.code === WEBHOOK_ENDPOINTS_NOT_ENTITLED_CODE) {
        throw new ForbiddenError(error.message);
      }
      throw error;
    }
    await next();
  };

  const { service, policy } = security.createVersionedApp({
    name: "webhooks",
    // The generation is the contract: `/api/webhooks/v1` has been live since
    // 2026-08, so its routes answer exactly where they answer today with no
    // dated namespace and no `/api/v1` twin beside them.
    basePath: "/api/webhooks/v1",
    staticGeneration: "v1",
    errorEnvelope: "canonical",
    errorHandler: () =>
      createCanonicalFamilyErrorHandler({
        loggerName: "langwatch:api:webhooks:errors",
        label: "Webhooks API Error",
        mapError: canonicalError,
      }),
    routeMiddleware: [requireWebhookPlan],
  });

  const endpointIdParams = z.object({ id: z.string().min(1) });

  return service
    .registerRoute(
      "post",
      "/endpoints",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, body: z.infer<typeof createEndpointSchema>) => {
        const organization = organizationOf(c);
        const { endpoint, secret } = await webhooks().endpoints.create({
          organizationId: organization.id,
          ...destinationFromBody(body),
          enabledEvents: body.enabled_events,
          maxBatchSize: body.max_batch_size,
          maxBatchDelayMs: body.max_batch_delay_ms,
          maxInFlight: body.max_in_flight,
        });
        return { data: { ...endpointResponse(endpoint), secret } };
      },
      (b) =>
        policy(requires("webhookEndpoints:manage"))(b)
          .withInput(createEndpointSchema)
          .withOutput(z.object({ data: endpointWithSecretDtoSchema }))
          .withStatus(201)
          // Scoped to the organization, not a project: this family
          // authenticates at the org, so that is the tenancy a key is unique
          // within. The framework reads the key, dispatches through the
          // process's ledger and writes a replay from the STORED bytes — a
          // replay of a lost create is the only way to recover its secret.
          .withIdempotency({
            operation: "webhooks.v1.endpoints.create",
            scope: (c) => organizationOf(c).id,
          })
          .withDocs({
            tags: ["Webhooks"],
            summary: "Create a webhook endpoint",
            description:
              "Create a webhook endpoint. Name one destination: `url` for `destination_kind: http`, `sqs` for `destination_kind: sqs`. Naming the other kind's field is a 400 that says which field does not belong, rather than a 201 that saved half the body. `destination_kind` may be omitted and then means `http`. The signing secret is returned ONCE in this response and never again; roll it to get a new one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including its `secret`, which is the only way to recover a secret whose response was lost in transit.",
            responses: {
              ...canonicalBaseResponses,
              ...canonicalConflictResponses,
              201: {
                description: "The endpoint, with the signing secret this body alone carries",
                headers: idempotentReplayHeaders,
                content: {
                  "application/json": {
                    schema: resolver(z.object({ data: endpointWithSecretDtoSchema })),
                  },
                },
              },
            },
          }),
    )
    .registerRoute(
      "get",
      "/endpoints",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext) => {
        const organization = organizationOf(c);
        const list = await webhooks().endpoints.getAll({ organizationId: organization.id });
        return { data: list.map(endpointResponse) };
      },
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withOutput(z.object({ data: z.array(endpointDtoSchema) }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "List webhook endpoints",
            description: "List the organization's webhook endpoints",
            responses: canonicalBaseResponses,
          }),
    )
    .registerRoute(
      "get",
      "/endpoints/:id",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string }) => {
        const organization = organizationOf(c);
        const endpoint = await webhooks().endpoints.getById({
          organizationId: organization.id,
          endpointId: input.id,
        });
        return { data: endpointResponse(endpoint) };
      },
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withParams(endpointIdParams)
          .withOutput(z.object({ data: endpointDtoSchema }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Get a webhook endpoint",
            description: "Get one webhook endpoint",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "patch",
      "/endpoints/:id",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string } & z.infer<typeof updateEndpointSchema>) =>
        updateEndpointHandler(webhooks, input, organizationOf(c)),
      (b) =>
        policy(requires("webhookEndpoints:manage"))(b)
          .withParams(endpointIdParams)
          .withInput(updateEndpointSchema)
          .withOutput(z.object({ data: endpointDtoSchema }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Update a webhook endpoint",
            description:
              "Update a webhook endpoint's address, event subscriptions, or status (`active` re-enables, `disabled` pauses; re-enabling does not re-send the gap, replay covers it). `destination_kind` cannot change: batches already planned against the old transport are in flight, so a move means a new endpoint alongside this one until it has drained.",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "delete",
      "/endpoints/:id",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string }) => {
        const organization = organizationOf(c);
        await webhooks().endpoints.archive({
          organizationId: organization.id,
          endpointId: input.id,
        });
        return { data: { archived: true as const } };
      },
      (b) =>
        policy(requires("webhookEndpoints:manage"))(b)
          .withParams(endpointIdParams)
          .withOutput(z.object({ data: z.object({ archived: z.literal(true) }) }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Archive a webhook endpoint",
            description: "Archive a webhook endpoint",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "post",
      "/endpoints/:id/roll-secret",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string }) => {
        const organization = organizationOf(c);
        const { endpoint, secret } = await webhooks().endpoints.rollSecret({
          organizationId: organization.id,
          endpointId: input.id,
        });
        return { data: { ...endpointResponse(endpoint), secret } };
      },
      (b) =>
        policy(requires("webhookEndpoints:manage"))(b)
          .withParams(endpointIdParams)
          .withOutput(z.object({ data: endpointWithSecretDtoSchema }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Roll an endpoint's signing secret",
            description:
              "Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it immediately.",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "post",
      "/endpoints/:id/test",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string }) =>
        testEndpointHandler(webhooks, input, organizationOf(c)),
      (b) =>
        policy(requires("webhookEndpoints:manage"))(b)
          .withParams(endpointIdParams)
          .withOutput(z.object({ data: testFireResultSchema }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Send a test event to an endpoint",
            description:
              "Send a signed test event through the full delivery path. Contract: the route answers 200 whenever the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the body, not the status code.",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "get",
      "/endpoints/:id/deliveries",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string } & z.infer<typeof deliveriesQuerySchema>) => {
        const organization = organizationOf(c);
        const { limit } = input;
        const cursorParam = input.cursor;
        let cursor: { firedAt: Date; id: string } | undefined;
        if (cursorParam) {
          const [firedAtMs, cursorId] = cursorParam.split("~");
          const parsedMs = Number(firedAtMs);
          if (!Number.isInteger(parsedMs) || !cursorId) {
            throw new BadRequestError("invalid cursor");
          }
          cursor = { firedAt: new Date(parsedMs), id: cursorId };
        }
        const page = await webhooks().endpoints.getDeliveries({
          organizationId: organization.id,
          endpointId: input.id,
          limit,
          cursor,
        });
        return {
          next_cursor: page.nextCursor
            ? `${page.nextCursor.firedAt.getTime()}~${page.nextCursor.id}`
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
            fired_at: r.firedAt.toISOString(),
          })),
        };
      },
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withParams(endpointIdParams)
          .withQuery(deliveriesQuerySchema)
          .withOutput(
            z.object({
              data: z.array(deliveryDtoSchema),
              next_cursor: nextCursorSchema,
            }),
          )
          .withDocs({
            tags: ["Webhooks"],
            summary: "List an endpoint's delivery attempts",
            description:
              "The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "get",
      "/endpoints/:id/health",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string }) => {
        const organization = organizationOf(c);
        const report = await webhooks().health.health({
          organizationId: organization.id,
          endpointId: input.id,
        });
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
      },
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withParams(endpointIdParams)
          .withOutput(z.object({ data: healthDtoSchema }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Read an endpoint's delivery health",
            description:
              "Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success rate, and p95 latency over the last hour.",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .registerRoute(
      "get",
      "/event-types",
      MANAGEMENT_API_VERSION,
      async () => ({
        data: WEBHOOK_EVENT_TYPES.map((t) => ({
          type: t.type,
          family: t.family,
          schema_version: t.schemaVersion,
          is_emitting: t.isEmitting,
          description: t.description,
        })),
      }),
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withOutput(z.object({ data: z.array(eventTypeDtoSchema) }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "List subscribable event types",
            description:
              "The event catalog: every subscribable type, grouped by family; types marked emitting=false are declared contracts whose producers have not shipped yet",
            responses: canonicalBaseResponses,
          }),
    )
    .registerRoute(
      "get",
      "/events",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, query: z.infer<typeof eventsQuerySchema>) => {
        const organization = organizationOf(c);
        // The service maps emitted types to row statuses and serves an empty
        // page for unknown types, so consumers can probe forward-compatibly
        // without an error.
        const page = await webhooks()
          .requireEvents()
          .getEmittedEvents({
            organizationId: organization.id,
            fromMs: query.from,
            toMs: query.to,
            cursor: query.cursor ?? null,
            limit: query.limit,
            types: query.type !== undefined ? [query.type] : undefined,
          });
        return { data: page.events, next_cursor: page.nextCursor };
      },
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withQuery(eventsQuerySchema)
          .withOutput(
            z.object({
              data: z.array(webhookEventEnvelopeSchema),
              next_cursor: nextCursorSchema,
            }),
          )
          .withDocs({
            tags: ["Webhooks"],
            summary: "List emitted events",
            description:
              "The organization's emitted-events log for the request families: cursor-paged, newest first, filter by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from` must not be later than `to` — a range that ends before it starts is rejected rather than answered with an empty page. They are required because the log is a ranged read over the 13-month spend table and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page rather than an error, so a client can probe forward-compatibly.",
            responses: canonicalBaseResponses,
          }),
    )
    .registerRoute(
      "get",
      "/events/:id",
      MANAGEMENT_API_VERSION,
      async (c: WebhookContext, input: { id: string }) => {
        const organization = organizationOf(c);
        const event = await webhooks().requireEvents().tryGetEmittedEventById({
          organizationId: organization.id,
          id: input.id,
        });
        if (!event) throw new WebhookEventNotFoundError();
        return { data: event };
      },
      (b) =>
        policy(requires("webhookEndpoints:view"))(b)
          .withParams(endpointIdParams)
          .withOutput(z.object({ data: webhookEventEnvelopeSchema }))
          .withDocs({
            tags: ["Webhooks"],
            summary: "Get one emitted event",
            description:
              "One emitted event by its id, as it was delivered. Serves the same families the events log serves. A 404 covers every reason the log cannot answer -- never emitted, past the retention horizon, or belonging to another organization -- because telling those apart would confirm the existence of another tenant's request ids.",
            responses: { ...canonicalBaseResponses, ...notFoundResponse },
          }),
    )
    .build();
}
