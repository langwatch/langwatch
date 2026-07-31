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
} from "@ee/webhooks/entitlement";
import { WEBHOOK_EVENT_TYPES } from "@ee/webhooks/eventRegistry";
import {
  WebhookEndpointNotFoundError,
  WebhookEndpointService,
  WebhookEndpointValidationError,
} from "@ee/webhooks/webhookEndpoint.service";
import { WebhookHealthService } from "@ee/webhooks/webhookHealth.service";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const orgInput = z.object({ organizationId: z.string() });
const endpointInput = orgInput.extend({ endpointId: z.string() });

/**
 * Enterprise gate for the whole surface, mirroring the REST app: the org's
 * active plan must carry `webhookEndpointsEnabled`. Runs after the RBAC check so
 * membership is already established.
 */
const requireWebhooksPlan = async ({
  input,
  next,
}: {
  input: { organizationId: string };
  next: () => any;
}) => {
  try {
    await assertWebhookEndpointsEntitled(input.organizationId);
  } catch (error) {
    if (error instanceof WebhookEndpointsNotEntitledError) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    throw error;
  }
  return next();
};

function service(prisma: PrismaClient) {
  return new WebhookEndpointService({ prisma });
}

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
    .use(checkOrganizationPermission("webhookEndpoints:view"))
    .use(requireWebhooksPlan)
    .query(() => WEBHOOK_EVENT_TYPES),

  list: protectedProcedure
    .input(orgInput)
    .use(checkOrganizationPermission("webhookEndpoints:view"))
    .use(requireWebhooksPlan)
    .query(({ ctx, input }) =>
      service(ctx.prisma).getAll({ organizationId: input.organizationId }),
    ),

  deliveries: protectedProcedure
    .input(
      endpointInput.extend({
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .use(checkOrganizationPermission("webhookEndpoints:view"))
    .use(requireWebhooksPlan)
    .query(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).getDeliveries({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
          limit: input.limit,
        }),
      ),
    ),

  create: protectedProcedure
    .input(
      orgInput.extend({
        url: z.string(),
        enabledEvents: z.array(z.string()).min(1),
        maxBatchSize: z.number().int().optional(),
        maxBatchDelayMs: z.number().int().optional(),
        maxInFlight: z.number().int().optional(),
      }),
    )
    .use(checkOrganizationPermission("webhookEndpoints:manage"))
    .use(requireWebhooksPlan)
    .mutation(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).create({
          organizationId: input.organizationId,
          url: input.url,
          enabledEvents: input.enabledEvents,
          maxBatchSize: input.maxBatchSize,
          maxBatchDelayMs: input.maxBatchDelayMs,
          maxInFlight: input.maxInFlight,
        }),
      ),
    ),

  health: protectedProcedure
    .input(endpointInput)
    .use(checkOrganizationPermission("webhookEndpoints:view"))
    .use(requireWebhooksPlan)
    .query(({ ctx, input }) =>
      translating(() =>
        new WebhookHealthService({
          prisma: ctx.prisma,
          endpoints: service(ctx.prisma),
          processStore: new PrismaProcessStore(ctx.prisma),
        }).health({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  update: protectedProcedure
    .input(
      endpointInput.extend({
        url: z.string().optional(),
        enabledEvents: z.array(z.string()).min(1).optional(),
        maxBatchSize: z.number().int().optional(),
        maxBatchDelayMs: z.number().int().optional(),
        maxInFlight: z.number().int().optional(),
      }),
    )
    .use(checkOrganizationPermission("webhookEndpoints:manage"))
    .use(requireWebhooksPlan)
    .mutation(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).update({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
          url: input.url,
          enabledEvents: input.enabledEvents,
          maxBatchSize: input.maxBatchSize,
          maxBatchDelayMs: input.maxBatchDelayMs,
          maxInFlight: input.maxInFlight,
        }),
      ),
    ),

  rollSecret: protectedProcedure
    .input(endpointInput)
    .use(checkOrganizationPermission("webhookEndpoints:manage"))
    .use(requireWebhooksPlan)
    .mutation(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).rollSecret({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  enable: protectedProcedure
    .input(endpointInput)
    .use(checkOrganizationPermission("webhookEndpoints:manage"))
    .use(requireWebhooksPlan)
    .mutation(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).enable({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  disable: protectedProcedure
    .input(endpointInput)
    .use(checkOrganizationPermission("webhookEndpoints:manage"))
    .use(requireWebhooksPlan)
    .mutation(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).disable({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),

  archive: protectedProcedure
    .input(endpointInput)
    .use(checkOrganizationPermission("webhookEndpoints:manage"))
    .use(requireWebhooksPlan)
    .mutation(({ ctx, input }) =>
      translating(() =>
        service(ctx.prisma).archive({
          organizationId: input.organizationId,
          endpointId: input.endpointId,
        }),
      ),
    ),
});
