import { z } from "zod";

import {
  sqsDestinationInputSchema,
  webhookDestinationKindSchema,
  webhookDeliveryControlsSchema,
} from "./webhook.ts";

export const createWebhookEndpointCommandSchema = z.object({
  organizationId: z.string().min(1),
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: sqsDestinationInputSchema.optional(),
  enabledEvents: z.array(z.string()).min(1),
  ...webhookDeliveryControlsSchema.partial().shape,
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
