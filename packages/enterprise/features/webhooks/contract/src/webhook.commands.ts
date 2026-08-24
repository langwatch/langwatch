import { z } from "zod";
import {
  sqsDestinationInputSchema,
  webhookDestinationKindSchema,
  webhookDeliveryControlsSchema,
} from "./webhook";

export const createWebhookEndpointCommandSchema = z
  .object({
    organizationId: z.string().min(1),
    destinationKind: webhookDestinationKindSchema.optional(),
    url: z.string().optional(),
    sqs: sqsDestinationInputSchema.optional(),
    enabledEvents: z.array(z.string()).min(1),
  })
  .and(webhookDeliveryControlsSchema.partial());
export type CreateWebhookEndpointCommand = z.infer<typeof createWebhookEndpointCommandSchema>;

export const updateWebhookEndpointCommandSchema = z
  .object({
    organizationId: z.string().min(1),
    endpointId: z.string().min(1),
    destinationKind: webhookDestinationKindSchema.optional(),
    url: z.string().optional(),
    sqs: sqsDestinationInputSchema.partial().optional(),
    enabledEvents: z.array(z.string()).min(1).optional(),
  })
  .and(webhookDeliveryControlsSchema.partial());
export type UpdateWebhookEndpointCommand = z.infer<typeof updateWebhookEndpointCommandSchema>;
