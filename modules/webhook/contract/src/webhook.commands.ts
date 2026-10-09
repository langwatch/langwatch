import { z } from "zod";

import {
  sqsDestinationInputSchema,
  webhookDestinationKindSchema,
  webhookDeliveryControlsSchema,
  webhookEnvelopeSchema,
  webhookSignatureSchemeSchema,
} from "./webhook.ts";

export const createWebhookEndpointCommandSchema = z.object({
  organizationId: z.string().min(1),
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: sqsDestinationInputSchema.optional(),
  enabledEvents: z.array(z.string()).min(1),
  ...webhookDeliveryControlsSchema.partial().shape,
  /** Governance's migration of inline anomaly destinations only; no door accepts it. */
  signatureScheme: webhookSignatureSchemeSchema.optional(),
  /** The same migration only: the rule's existing secret signs, so its receiver keeps verifying. */
  sharedSecret: z.string().min(1).max(512).optional(),
  /** The same migration only: unique per organization, a repeat answers the existing endpoint. */
  idempotencyKey: z.string().min(1).optional(),
});
export type CreateWebhookEndpointCommand = z.infer<typeof createWebhookEndpointCommandSchema>;

export const updateWebhookEndpointCommandSchema = z.object({
  organizationId: z.string().min(1),
  endpointId: z.string().min(1),
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: sqsDestinationInputSchema.partial().optional(),
  enabledEvents: z.array(z.string()).min(1).optional(),
  ...webhookDeliveryControlsSchema.partial().shape,
});
export type UpdateWebhookEndpointCommand = z.infer<typeof updateWebhookEndpointCommandSchema>;

/** An update plus the status the caller asked for, applied as one change. */
export const applyWebhookEndpointChangesCommandSchema = z.object({
  ...updateWebhookEndpointCommandSchema.shape,
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});
export type ApplyWebhookEndpointChangesCommand = z.infer<
  typeof applyWebhookEndpointChangesCommandSchema
>;

export const listWebhookEventsQuerySchema = z.object({
  organizationId: z.string().min(1),
  fromMs: z.number().int().min(0).optional(),
  toMs: z.number().int().min(0).optional(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(200),
  types: z.array(z.string()).optional(),
});
export type ListWebhookEventsQuery = z.infer<typeof listWebhookEventsQuerySchema>;

export const listWebhookEventsResultSchema = z.object({
  events: z.array(webhookEnvelopeSchema),
  nextCursor: z.string().nullable(),
});
export type ListWebhookEventsResult = z.infer<typeof listWebhookEventsResultSchema>;
