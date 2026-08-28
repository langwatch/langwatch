/**
 * tRPC router for Org Settings > Webhooks. Session-auth sibling of the
 * org-key REST surface at /api/webhooks/v1: same service, same RBAC
 * scopes (webhookEndpoints:view|manage), same enterprise plan gate.
 *
 * The signing secret crosses to the client exactly once, in the create and
 * rollSecret mutation responses; every read path returns endpoint views
 * without secret material.
 */

import {
  assertWebhookEndpointsEntitled,
  WebhookEndpointsNotEntitledError,
} from "~/runtime/app/features/webhooks";
import { WEBHOOK_EVENT_TYPES } from "@langwatch/enterprise-webhook-contract";
import {
  WebhookEndpointNotFoundError,
  WebhookEndpointValidationError,
} from "~/runtime/app/features/webhooks";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { WEBHOOK_DESTINATION_KINDS } from "~/utils/webhookDestinations";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const orgInput = z.object({ organizationId: z.string() });
const endpointInput = orgInput.extend({ endpointId: z.string() });

/**
 * The queue half of a destination. Which credential fields are ALLOWED is the
 * service's call; this only says what may be sent.
 *
 * The credential fields are nullable, not merely optional, because the
 * service reads the two differently: absent means "keep what is stored" and
 * null means "clear it". Without null there is no way through this surface to
 * rotate an endpoint off static keys, which is the one operation a leaked key
 * demands.
 */
const sqsDestinationInput = z.object({
  queueUrl: z.string(),
  roleArn: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  accessKeyId: z.string().nullable().optional(),
  secretAccessKey: z.string().nullable().optional(),
});

/**
 * Enterprise gate for the whole surface, mirroring the REST app: the org's
 * active plan must carry `webhookEndpointsEnabled`. Runs after the RBAC check so
 * membership is already established.
 */
const assertWebhooksPlan = async (organizationId: string): Promise<void> => {
  try {
    await assertWebhookEndpointsEntitled(organizationId);
  } catch (error) {
    if (error instanceof WebhookEndpointsNotEntitledError) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    throw error;
  }
};

/** Map service errors onto tRPC codes so the UI gets actionable messages. */
async function translating<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WebhookEndpointValidationError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    if (error instanceof WebhookEndpointNotFoundError) {
      throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    }
    throw error;
  }
}

export const webhookEndpointsRouter = createTRPCRouter({
  /** The event catalog the drawer renders its checkboxes from. */
  eventTypes: protectedProcedure
    .input(orgInput)
    .permission("webhookEndpoints:view")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .query(() => WEBHOOK_EVENT_TYPES),

  list: protectedProcedure
    .input(orgInput)
    .permission("webhookEndpoints:view")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .query(({ ctx, input }) =>
      ctx.app.gateway.webhookEndpoints.getAll({ organizationId: input.organizationId }),
    ),

  deliveries: protectedProcedure
    .input(
      endpointInput.extend({
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.object({ firedAt: z.coerce.date(), id: z.string() }).optional(),
      }),
    )
    .permission("webhookEndpoints:view")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .query(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.getDeliveries({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
          limit: input.limit,
          cursor: input.cursor,
        }),
      ),
    ),

  create: protectedProcedure
    .input(
      orgInput.extend({
        destinationKind: z.enum(WEBHOOK_DESTINATION_KINDS).optional(),
        url: z.string().optional(),
        sqs: sqsDestinationInput.optional(),
        enabledEvents: z.array(z.string()).min(1),
        maxBatchSize: z.number().int().optional(),
        maxBatchDelayMs: z.number().int().optional(),
        maxInFlight: z.number().int().optional(),
      }),
    )
    .permission("webhookEndpoints:manage")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .mutation(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.create({
          organizationId: input.organizationId,
          destinationKind: input.destinationKind,
          url: input.url,
          sqs: input.sqs,
          enabledEvents: input.enabledEvents,
          maxBatchSize: input.maxBatchSize,
          maxBatchDelayMs: input.maxBatchDelayMs,
          maxInFlight: input.maxInFlight,
        }),
      ),
    ),

  health: protectedProcedure
    .input(endpointInput)
    .permission("webhookEndpoints:view")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .query(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookHealth.health({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  update: protectedProcedure
    .input(
      endpointInput.extend({
        // Accepted only when it repeats the kind the endpoint already has.
        // Zod strips unknown keys, so leaving it out would silently drop a
        // caller's attempted kind change and answer success where REST
        // refuses: two surfaces, two answers to the same request.
        destinationKind: z.enum(WEBHOOK_DESTINATION_KINDS).optional(),
        url: z.string().optional(),
        sqs: sqsDestinationInput.partial().optional(),
        enabledEvents: z.array(z.string()).min(1).optional(),
        maxBatchSize: z.number().int().optional(),
        maxBatchDelayMs: z.number().int().optional(),
        maxInFlight: z.number().int().optional(),
      }),
    )
    .permission("webhookEndpoints:manage")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .mutation(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.update({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
          destinationKind: input.destinationKind,
          url: input.url,
          sqs: input.sqs,
          enabledEvents: input.enabledEvents,
          maxBatchSize: input.maxBatchSize,
          maxBatchDelayMs: input.maxBatchDelayMs,
          maxInFlight: input.maxInFlight,
        }),
      ),
    ),

  rollSecret: protectedProcedure
    .input(endpointInput)
    .permission("webhookEndpoints:manage")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .mutation(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.rollSecret({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  enable: protectedProcedure
    .input(endpointInput)
    .permission("webhookEndpoints:manage")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .mutation(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.enable({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  disable: protectedProcedure
    .input(endpointInput)
    .permission("webhookEndpoints:manage")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .mutation(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.disable({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  archive: protectedProcedure
    .input(endpointInput)
    .permission("webhookEndpoints:manage")
    .use(async ({ input, next }) => {
      await assertWebhooksPlan(input.organizationId);
      return next();
    })
    .mutation(({ ctx, input }) =>
      translating(() =>
        ctx.app.gateway.webhookEndpoints.archive({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),
});
