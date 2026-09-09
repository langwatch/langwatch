/**
 * Every `webhookEndpoints.*` procedure, declared once. The names are the
 * browser's cache keys, so they are the wire names the settings screen has
 * always called, and the schemas below are the ones it has always sent.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  webhookDeliveryPageSchema,
  webhookDestinationKindSchema,
  webhookEndpointHealthSchema,
  webhookEndpointViewSchema,
  webhookEndpointWithSecretSchema,
} from "./webhook.ts";
import { webhookEventTypeSchema } from "./webhook.events.ts";

/** Every procedure on this surface names the organization it acts within. */
export const webhookEndpointOrganizationScopeSchema = z.object({
  organizationId: z.string(),
});

export const webhookEndpointScopeSchema = z.object({
  ...webhookEndpointOrganizationScopeSchema.shape,
  endpointId: z.string(),
});

/**
 * The queue half of a destination; which credentials are ALLOWED is the
 * application's call. They are nullable, not merely optional: absent keeps what
 * is stored and null clears it, and clearing is what a leaked key demands.
 */
export const webhookEndpointSqsInputSchema = z.object({
  queueUrl: z.string(),
  roleArn: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  accessKeyId: z.string().nullable().optional(),
  secretAccessKey: z.string().nullable().optional(),
});

export const webhookEndpointDeliveriesInputSchema = z.object({
  ...webhookEndpointScopeSchema.shape,
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.object({ firedAt: z.coerce.date(), id: z.string() }).optional(),
});

export const webhookEndpointCreateInputSchema = z.object({
  ...webhookEndpointOrganizationScopeSchema.shape,
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: webhookEndpointSqsInputSchema.optional(),
  enabledEvents: z.array(z.string()).min(1),
  maxBatchSize: z.number().int().optional(),
  maxBatchDelayMs: z.number().int().optional(),
  maxInFlight: z.number().int().optional(),
});

export const webhookEndpointUpdateInputSchema = z.object({
  ...webhookEndpointScopeSchema.shape,
  // Accepted only when it repeats the kind the endpoint already has. Zod
  // strips unknown keys, so leaving it out would silently drop a caller's
  // attempted kind change and answer success where REST refuses.
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: webhookEndpointSqsInputSchema.partial().optional(),
  enabledEvents: z.array(z.string()).min(1).optional(),
  maxBatchSize: z.number().int().optional(),
  maxBatchDelayMs: z.number().int().optional(),
  maxInFlight: z.number().int().optional(),
});

export const webhookEndpointTrpc = defineTrpcContract("webhookEndpoints")
  /** The event catalog the drawer renders its checkboxes from. */
  .query("eventTypes")
  .withInput(webhookEndpointOrganizationScopeSchema)
  .withOutput(webhookEventTypeSchema.array())

  .query("list")
  .withInput(webhookEndpointOrganizationScopeSchema)
  .withOutput(webhookEndpointViewSchema.array())

  .query("deliveries")
  .withInput(webhookEndpointDeliveriesInputSchema)
  .withOutput(webhookDeliveryPageSchema)

  .mutation("create")
  .withInput(webhookEndpointCreateInputSchema)
  .withOutput(webhookEndpointWithSecretSchema)

  .query("health")
  .withInput(webhookEndpointScopeSchema)
  .withOutput(webhookEndpointHealthSchema)

  .mutation("update")
  .withInput(webhookEndpointUpdateInputSchema)
  .withOutput(webhookEndpointViewSchema)

  .mutation("rollSecret")
  .withInput(webhookEndpointScopeSchema)
  .withOutput(webhookEndpointWithSecretSchema)

  .mutation("enable")
  .withInput(webhookEndpointScopeSchema)
  .withOutput(webhookEndpointViewSchema)

  .mutation("disable")
  .withInput(webhookEndpointScopeSchema)
  .withOutput(webhookEndpointViewSchema)

  .mutation("archive")
  .withInput(webhookEndpointScopeSchema)
  .withOutput(z.void())
  .build();
