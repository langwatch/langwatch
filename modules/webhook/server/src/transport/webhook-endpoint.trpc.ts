/**
 * The server half of `webhookEndpoints.*`, the session-authenticated sibling of
 * `/api/webhooks/v1`. The runtime checks the permission, then each handler asks
 * the Enterprise plan gate: the order this surface has always had.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { fromDate, toDate } from "@langwatch/time";
import {
  WEBHOOK_EVENT_TYPES,
  WebhookApi,
  webhookEndpointTrpc,
} from "@langwatch/webhook-contract";

export const webhookEndpointTrpcTransport = defineTrpcRouter(WebhookApi, webhookEndpointTrpc)
  .procedure("eventTypes")
  .withPermission("webhookEndpoints:view")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return [...WEBHOOK_EVENT_TYPES];
  })

  .procedure("list")
  .withPermission("webhookEndpoints:view")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.getAll({ organizationId: input.organizationId });
  })

  .procedure("deliveries")
  .withPermission("webhookEndpoints:view")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    const page = await app.getDeliveries({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
      limit: input.limit,
      cursor: input.cursor
        ? { firedAt: fromDate(input.cursor.firedAt), id: input.cursor.id }
        : undefined,
    });

    return {
      deliveries: page.deliveries.map((delivery) => ({
        ...delivery,
        firedAt: toDate(delivery.firedAt),
      })),
      nextCursor: page.nextCursor
        ? { firedAt: toDate(page.nextCursor.firedAt), id: page.nextCursor.id }
        : null,
    };
  })

  .procedure("create")
  .withPermission("webhookEndpoints:manage")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.create({
      organizationId: input.organizationId,
      destinationKind: input.destinationKind,
      url: input.url,
      sqs: input.sqs,
      enabledEvents: input.enabledEvents,
      maxBatchSize: input.maxBatchSize,
      maxBatchDelayMs: input.maxBatchDelayMs,
      maxInFlight: input.maxInFlight,
    });
  })

  .procedure("health")
  .withPermission("webhookEndpoints:view")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.getHealth({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
    });
  })

  .procedure("update")
  .withPermission("webhookEndpoints:manage")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.update({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
      destinationKind: input.destinationKind,
      url: input.url,
      sqs: input.sqs,
      enabledEvents: input.enabledEvents,
      maxBatchSize: input.maxBatchSize,
      maxBatchDelayMs: input.maxBatchDelayMs,
      maxInFlight: input.maxInFlight,
    });
  })

  .procedure("rollSecret")
  .withPermission("webhookEndpoints:manage")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.rollSecret({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
    });
  })

  .procedure("enable")
  .withPermission("webhookEndpoints:manage")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.enable({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
    });
  })

  .procedure("disable")
  .withPermission("webhookEndpoints:manage")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    return app.disable({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
    });
  })

  .procedure("archive")
  .withPermission("webhookEndpoints:manage")
  .handle(async ({ app, input }) => {
    await app.assertEndpointsEntitled(input.organizationId);

    await app.archive({
      organizationId: input.organizationId,
      endpointId: input.endpointId,
    });
  })
  .build();
