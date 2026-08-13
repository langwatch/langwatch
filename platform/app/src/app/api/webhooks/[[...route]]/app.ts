/**
 * The webhook platform's management family: endpoints, their delivery log and
 * health, the event catalog, and the emitted-events log.
 *
 * RPC-named per ADR-094 — `POST /endpoints.rollSecret`, not
 * `POST /endpoints/{id}/roll-secret`. The operation lives in the name, every
 * argument travels in the body (which is what finally puts zod on the
 * identifiers), and the four verb-shaped operations this family always had
 * stop pretending to be sub-resources. This is a pilot; the other management
 * families remain resource-REST.
 *
 * Built on `@langwatch/api` through `createManagementService`, so every
 * endpoint declares its RBAC permission once and gets the SecuredApp policy
 * registration, org-key authentication (throwing mode), the permission check
 * (403) and the plan gate (402) in that order. The gate admits on the
 * `webhookEndpointsEnabled` plan flag rather than the Enterprise tier: the
 * feature is licensable on its own, so a Pro or Custom contract can carry it.
 *
 * This module is the registration and wiring seam only: the wire vocabulary
 * lives in `wire.ts` and the handlers in `handlers.ts`.
 */
import type { VersionBuilder } from "@langwatch/api";
import { WebhookEndpointService } from "@ee/webhooks/webhookEndpoint.service";
import { WebhookEventsService } from "@ee/webhooks/webhookEvents.service";
import { WebhookHealthService } from "@ee/webhooks/webhookHealth.service";
import { z } from "zod";

import { routeHandlers } from "@langwatch/api";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import {
  archiveEndpoint,
  createEndpoint,
  getEndpoint,
  getEndpointHealth,
  getEvent,
  listEndpointDeliveries,
  listEndpoints,
  listEvents,
  listEventTypes,
  rollEndpointSecret,
  testEndpoint,
  updateEndpoint,
} from "./handlers";
import {
  archivedDtoSchema,
  createEndpointSchema,
  deliveryDtoSchema,
  endpointDtoSchema,
  endpointRefSchema,
  endpointWithSecretDtoSchema,
  eventRefSchema,
  eventTypeDtoSchema,
  healthDtoSchema,
  listDeliveriesSchema,
  listEventsSchema,
  nextCursorSchema,
  testFireResultSchema,
  updateEndpointSchema,
  webhookEventEnvelopeSchema,
  type WebhooksFamilyApp,
} from "./wire";

const { service, guard } = createManagementService({
  name: "webhooks",
  basePath: "/api/webhooks",
  feature: "WEBHOOKS",
  entitlement: "webhookEndpointsEnabled",
});

type WebhooksVersion = VersionBuilder<WebhooksFamilyApp>;

// ── endpoint registration ────────────────────────────────────────────────────

const registerEndpointEndpoints = (v: WebhooksVersion): void => {
  v.rpc(
    "/endpoints.create",
    {
      ...guard("webhookEndpoints:manage"),
      input: createEndpointSchema,
      output: z.object({ data: endpointWithSecretDtoSchema }),
      status: 201,
      description:
        "Create a webhook endpoint. The signing secret is returned ONCE in this response and never again; roll it to get a new one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including its `secret`, which is the only way to recover a secret whose response was lost in transit.",
      docs: { operationId: "createWebhookEndpoint", tags: ["Webhooks"] },
    },
    createEndpoint,
  );

  v.rpc(
    "/endpoints.list",
    {
      ...guard("webhookEndpoints:view"),
      output: z.object({ data: z.array(endpointDtoSchema) }),
      description:
        "List the organization's webhook endpoints. Archived endpoints are excluded.",
      docs: { operationId: "listWebhookEndpoints", tags: ["Webhooks"] },
    },
    listEndpoints,
  );

  v.rpc(
    "/endpoints.get",
    {
      ...guard("webhookEndpoints:view"),
      input: endpointRefSchema,
      output: z.object({ data: endpointDtoSchema }),
      description: "Read one webhook endpoint.",
      docs: { operationId: "getWebhookEndpoint", tags: ["Webhooks"] },
    },
    getEndpoint,
  );

  v.rpc(
    "/endpoints.update",
    {
      ...guard("webhookEndpoints:manage"),
      input: updateEndpointSchema,
      output: z.object({ data: endpointDtoSchema }),
      description:
        "Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled` pauses; re-enabling does not re-send the gap, replay covers it). Partial: only the fields present are written.",
      docs: { operationId: "updateWebhookEndpoint", tags: ["Webhooks"] },
    },
    updateEndpoint,
  );

  v.rpc(
    "/endpoints.archive",
    {
      ...guard("webhookEndpoints:manage"),
      input: endpointRefSchema,
      output: z.object({ data: archivedDtoSchema }),
      description:
        "Archive a webhook endpoint: it disappears from every read and delivers nothing further.",
      docs: { operationId: "archiveWebhookEndpoint", tags: ["Webhooks"] },
    },
    archiveEndpoint,
  );

  v.rpc(
    "/endpoints.rollSecret",
    {
      ...guard("webhookEndpoints:manage"),
      input: endpointRefSchema,
      output: z.object({ data: endpointWithSecretDtoSchema }),
      description:
        "Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it immediately, and the previous secret stays valid for a short window so a receiver can swap on its own schedule.",
      docs: { operationId: "rollWebhookEndpointSecret", tags: ["Webhooks"] },
    },
    rollEndpointSecret,
  );

  v.rpc(
    "/endpoints.test",
    {
      ...guard("webhookEndpoints:manage"),
      input: endpointRefSchema,
      output: z.object({ data: testFireResultSchema }),
      description:
        "Send a signed test event through the full delivery path. Contract: this answers 200 whenever the test itself ran; `data.delivered` says whether the receiver accepted it, so clients must read the body, not the status code.",
      docs: { operationId: "sendWebhookEndpointTest", tags: ["Webhooks"] },
    },
    testEndpoint,
  );

  v.rpc(
    "/endpoints.listDeliveries",
    {
      ...guard("webhookEndpoints:view"),
      input: listDeliveriesSchema,
      output: z.object({
        data: z.array(deliveryDtoSchema),
        next_cursor: nextCursorSchema,
      }),
      description:
        "The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error. Cursor-paged, newest first.",
      docs: {
        operationId: "listWebhookEndpointDeliveries",
        tags: ["Webhooks"],
      },
    },
    listEndpointDeliveries,
  );

  v.rpc(
    "/endpoints.getHealth",
    {
      ...guard("webhookEndpoints:view"),
      input: endpointRefSchema,
      output: z.object({ data: healthDtoSchema }),
      description:
        "Delivery health. The headline number is `oldest_undelivered_age_ms`, the feed's staleness: age of the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends per minute, success rate, and p95 latency over the last hour.",
      docs: { operationId: "getWebhookEndpointHealth", tags: ["Webhooks"] },
    },
    getEndpointHealth,
  );
};

const registerEventEndpoints = (v: WebhooksVersion): void => {
  v.rpc(
    "/eventTypes.list",
    {
      ...guard("webhookEndpoints:view"),
      output: z.object({ data: z.array(eventTypeDtoSchema) }),
      description:
        "The event catalog: every subscribable type, grouped by family. Types marked `is_emitting: false` are declared contracts whose producers have not shipped yet.",
      docs: { operationId: "listWebhookEventTypes", tags: ["Webhooks"] },
    },
    listEventTypes,
  );

  v.rpc(
    "/events.list",
    {
      ...guard("webhookEndpoints:view"),
      input: listEventsSchema,
      output: z.object({
        data: z.array(webhookEventEnvelopeSchema),
        next_cursor: nextCursorSchema,
      }),
      description:
        "The organization's emitted-events log for the request families: cursor-paged, newest first, filter by type. `from` and `to` bound the created range in epoch milliseconds, are REQUIRED, and `from` must not be later than `to` — a range that ends before it starts is rejected rather than answered with an empty page. They are required because the log is a ranged read over the 13-month spend table and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page rather than an error, so a client can probe forward-compatibly.",
      docs: { operationId: "listWebhookEvents", tags: ["Webhooks"] },
    },
    listEvents,
  );

  v.rpc(
    "/events.get",
    {
      ...guard("webhookEndpoints:view"),
      input: eventRefSchema,
      output: z.object({ data: webhookEventEnvelopeSchema }),
      description:
        "One emitted event by its id, as it was delivered. Serves the same families the events log serves. A 404 covers every reason the log cannot answer — never emitted, past the retention horizon, or belonging to another organization — because telling those apart would confirm the existence of another tenant's request ids.",
      docs: { operationId: "getWebhookEvent", tags: ["Webhooks"] },
    },
    getEvent,
  );
};

export const app = service
  .provide({
    endpoints: () => new WebhookEndpointService({ prisma }),
    health: () =>
      new WebhookHealthService({
        endpoints: new WebhookEndpointService({ prisma }),
        processStore: new PrismaProcessStore(prisma),
      }),
    /**
     * Resolved per CALL rather than per request, so the two endpoints that
     * need ClickHouse pay for it and the ten that do not stay unaffected on a
     * deployment without it — and the deployment's configuration is read at
     * request time rather than once at import.
     *
     * Deliberately a plain `Error`: a deployment with no ClickHouse is an
     * operator condition the API caller cannot act on, so it degrades to the
     * generic unknown with a trace id rather than promising a remedy that is
     * not theirs to apply.
     */
    events: () => () => {
      const repository = getApp().gateway.webhookEvents;
      if (!repository) throw new Error("ClickHouse is not configured");
      return new WebhookEventsService({ prisma, repository });
    },
  })
  .version(MANAGEMENT_API_VERSION, (v) => {
    registerEndpointEndpoints(v);
    registerEventEndpoints(v);
  })
  .build();

export const { GET, POST, PUT, PATCH, DELETE } = routeHandlers(app);
