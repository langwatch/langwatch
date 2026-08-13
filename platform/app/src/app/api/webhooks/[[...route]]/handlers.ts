/**
 * The webhooks family's handlers.
 *
 * Each one reads validated `input`, calls the service layer, and returns raw
 * data for the framework to validate against the endpoint's `output`. Nothing
 * here decides policy, builds an envelope, or encodes a cursor: those live in
 * `@ee/webhooks/*` so the REST surface and the tRPC router that backs the
 * settings UI reach one implementation.
 */
import { WEBHOOK_EVENT_TYPES } from "@ee/webhooks/eventRegistry";
import {
  decodeDeliveryCursor,
  encodeDeliveryCursor,
} from "@ee/webhooks/webhookEndpoint.service";
import { WebhookEventNotFoundError } from "@ee/webhooks/webhookEvents.service";
import type { Context } from "hono";
import type { z } from "zod";

import type { Organization } from "~/generated/prisma/client";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  readIdempotencyKey,
  withIdempotency,
} from "~/server/api/idempotency";
import { prisma } from "~/server/db";
import { toStoredEnum } from "~/server/gateway/wireEnums";
import {
  deliveryResponse,
  endpointResponse,
  healthResponse,
  type createEndpointSchema,
  type endpointRefSchema,
  type endpointWithSecretDtoSchema,
  type eventRefSchema,
  type listDeliveriesSchema,
  type listEventsSchema,
  type updateEndpointSchema,
  type WebhooksFamilyApp,
} from "./wire";

/**
 * The organization the auth chain resolved. This family authenticates at the
 * organization, so that is the tenancy every read and write is scoped to —
 * never the project.
 */
function orgId(c: Context): string {
  return (c.get("organization") as Organization).id;
}

type App = WebhooksFamilyApp;

/**
 * Create is the one write here that carries `Idempotency-Key`, and the reason
 * is the secret: it is returned exactly once, so a retry whose response was
 * lost in transit is the ONLY way to recover it. A replay therefore has to
 * reproduce the original body verbatim, secret included, rather than re-running
 * the create.
 *
 * Scoped to the organization, not a project: this family authenticates at the
 * org, so that is the tenancy a key is unique within.
 */
export async function createEndpoint(
  c: Context,
  { input, app }: { input: z.infer<typeof createEndpointSchema>; app: App },
) {
  const outcome = await withIdempotency({
    prisma,
    operation: "webhooks.endpoints.create",
    scopeId: orgId(c),
    key: readIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER)),
    validatedBody: input,
    handler: async () => {
      const { endpoint, secret } = await app.endpoints.create({
        organizationId: orgId(c),
        url: input.url,
        enabledEvents: input.enabled_events,
        maxBatchSize: input.max_batch_size,
        maxBatchDelayMs: input.max_batch_delay_ms,
        maxInFlight: input.max_in_flight,
      });
      return {
        status: 201,
        body: { data: { ...endpointResponse(endpoint), secret } },
      };
    },
  });

  if (outcome.isReplayed) {
    c.header(IDEMPOTENT_REPLAY_HEADER, "true");
    // The stored body is the serialized original. Parsed back rather than
    // re-derived, so the replay is the same bytes the first call sent; the
    // framework re-validates it against `output` on the way out.
    return JSON.parse(outcome.serializedBody) as {
      data: z.infer<typeof endpointWithSecretDtoSchema>;
    };
  }
  return outcome.body;
}

export async function listEndpoints(c: Context, { app }: { app: App }) {
  const list = await app.endpoints.getAll({ organizationId: orgId(c) });
  return { data: list.map(endpointResponse) };
}

export async function getEndpoint(
  c: Context,
  { input, app }: { input: z.infer<typeof endpointRefSchema>; app: App },
) {
  const endpoint = await app.endpoints.getById({
    organizationId: orgId(c),
    endpointId: input.id,
  });
  return { data: endpointResponse(endpoint) };
}

export async function updateEndpoint(
  c: Context,
  { input, app }: { input: z.infer<typeof updateEndpointSchema>; app: App },
) {
  const endpoint = await app.endpoints.applyEdit({
    organizationId: orgId(c),
    endpointId: input.id,
    url: input.url,
    enabledEvents: input.enabled_events,
    maxBatchSize: input.max_batch_size,
    maxBatchDelayMs: input.max_batch_delay_ms,
    maxInFlight: input.max_in_flight,
    status: input.status && toStoredEnum(input.status),
  });
  return { data: endpointResponse(endpoint) };
}

export async function archiveEndpoint(
  c: Context,
  { input, app }: { input: z.infer<typeof endpointRefSchema>; app: App },
) {
  await app.endpoints.archive({
    organizationId: orgId(c),
    endpointId: input.id,
  });
  return { data: { archived: true as const } };
}

export async function rollEndpointSecret(
  c: Context,
  { input, app }: { input: z.infer<typeof endpointRefSchema>; app: App },
) {
  const { endpoint, secret } = await app.endpoints.rollSecret({
    organizationId: orgId(c),
    endpointId: input.id,
  });
  return { data: { ...endpointResponse(endpoint), secret } };
}

/**
 * Answers whenever the test itself ran — `data.delivered` carries the
 * receiver's verdict, so a refusing receiver is a 200 with `delivered: false`,
 * not an error status. Clients must read the body.
 */
export async function testEndpoint(
  c: Context,
  { input, app }: { input: z.infer<typeof endpointRefSchema>; app: App },
) {
  const result = await app.endpoints.sendTestFire({
    organizationId: orgId(c),
    endpointId: input.id,
  });
  return {
    data: {
      delivered: result.delivered,
      response_status: result.responseStatus,
      ...(result.responseBody !== undefined
        ? { response_body: result.responseBody }
        : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    },
  };
}

export async function listEndpointDeliveries(
  c: Context,
  { input, app }: { input: z.infer<typeof listDeliveriesSchema>; app: App },
) {
  const page = await app.endpoints.getDeliveries({
    organizationId: orgId(c),
    endpointId: input.id,
    limit: input.limit,
    cursor: decodeDeliveryCursor(input.cursor),
  });
  return {
    data: page.deliveries.map(deliveryResponse),
    next_cursor: page.nextCursor ? encodeDeliveryCursor(page.nextCursor) : null,
  };
}

export async function getEndpointHealth(
  c: Context,
  { input, app }: { input: z.infer<typeof endpointRefSchema>; app: App },
) {
  const report = await app.health.health({
    organizationId: orgId(c),
    endpointId: input.id,
  });
  return { data: healthResponse(report) };
}

export function listEventTypes() {
  return {
    data: WEBHOOK_EVENT_TYPES.map((t) => ({
      type: t.type,
      family: t.family,
      schema_version: t.schemaVersion,
      is_emitting: t.isEmitting,
      description: t.description,
    })),
  };
}

export async function listEvents(
  c: Context,
  { input, app }: { input: z.infer<typeof listEventsSchema>; app: App },
) {
  // The service maps emitted types to row statuses and serves an empty page
  // for unknown types, so consumers can probe forward-compatibly without an
  // error.
  const page = await app.events().getEmittedEvents({
    organizationId: orgId(c),
    fromMs: input.from,
    toMs: input.to,
    cursor: input.cursor ?? null,
    limit: input.limit,
    types: input.type !== undefined ? [input.type] : undefined,
  });
  return { data: page.events, next_cursor: page.nextCursor };
}

export async function getEvent(
  c: Context,
  { input, app }: { input: z.infer<typeof eventRefSchema>; app: App },
) {
  const event = await app.events().getEmittedEventById({
    organizationId: orgId(c),
    id: input.id,
  });
  // One 404 covers every reason the log cannot answer -- never emitted, past
  // the retention horizon, or another organization's -- because telling them
  // apart would confirm the existence of another tenant's request ids.
  if (!event) throw new WebhookEventNotFoundError();
  return { data: event };
}
