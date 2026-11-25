import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  sqsDestinationInputSchema,
  webhookDestinationKindSchema,
  webhookDeliveryControlsSchema,
  webhookEnvelopeSchema,
  webhookSignatureSchemeSchema,
} from "./webhook.ts";

const createWebhookEndpointCommandSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: sqsDestinationInputSchema.optional(),
  enabledEvents: z.array(z.string()).min(1),
  ...webhookDeliveryControlsSchema.partial().shape,
  allowSelfSignedCertificate: z.boolean().optional(),
  /** Governance's migration of inline anomaly destinations only; no door accepts it. */
  signatureScheme: webhookSignatureSchemeSchema.optional(),
  /** The same migration only: the rule's existing secret signs, so its receiver keeps verifying. */
  sharedSecret: z.string().min(1).max(512).optional(),
  /** The same migration only: unique per organization, a repeat answers the existing endpoint. */
  idempotencyKey: z.string().min(1).optional(),
});
export interface CreateWebhookEndpointCommandSchema extends Named<
  typeof createWebhookEndpointCommandSchemaDefinition
> {}
export const createWebhookEndpointCommandSchema: CreateWebhookEndpointCommandSchema =
  createWebhookEndpointCommandSchemaDefinition;
export type CreateWebhookEndpointCommand = z.infer<typeof createWebhookEndpointCommandSchema>;

const updateWebhookEndpointCommandSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  endpointId: z.string().min(1),
  destinationKind: webhookDestinationKindSchema.optional(),
  url: z.string().optional(),
  sqs: sqsDestinationInputSchema.partial().optional(),
  enabledEvents: z.array(z.string()).min(1).optional(),
  ...webhookDeliveryControlsSchema.partial().shape,
  allowSelfSignedCertificate: z.boolean().optional(),
});
export interface UpdateWebhookEndpointCommandSchema extends Named<
  typeof updateWebhookEndpointCommandSchemaDefinition
> {}
export const updateWebhookEndpointCommandSchema: UpdateWebhookEndpointCommandSchema =
  updateWebhookEndpointCommandSchemaDefinition;
export type UpdateWebhookEndpointCommand = z.infer<typeof updateWebhookEndpointCommandSchema>;

/** An update plus the status the caller asked for, applied as one change. */
const applyWebhookEndpointChangesCommandSchemaDefinition = z.object({
  ...updateWebhookEndpointCommandSchema.shape,
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});
export interface ApplyWebhookEndpointChangesCommandSchema extends Named<
  typeof applyWebhookEndpointChangesCommandSchemaDefinition
> {}
export const applyWebhookEndpointChangesCommandSchema: ApplyWebhookEndpointChangesCommandSchema =
  applyWebhookEndpointChangesCommandSchemaDefinition;
export type ApplyWebhookEndpointChangesCommand = z.infer<
  typeof applyWebhookEndpointChangesCommandSchema
>;

const listWebhookEventsQuerySchemaDefinition = z.object({
  organizationId: z.string().min(1),
  fromMs: z.number().int().min(0).optional(),
  toMs: z.number().int().min(0).optional(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(200),
  types: z.array(z.string()).optional(),
});
export interface ListWebhookEventsQuerySchema extends Named<
  typeof listWebhookEventsQuerySchemaDefinition
> {}
export const listWebhookEventsQuerySchema: ListWebhookEventsQuerySchema =
  listWebhookEventsQuerySchemaDefinition;
export type ListWebhookEventsQuery = z.infer<typeof listWebhookEventsQuerySchema>;

const listWebhookEventsResultSchemaDefinition = z.object({
  events: z.array(webhookEnvelopeSchema),
  nextCursor: z.string().nullable(),
});
export interface ListWebhookEventsResultSchema extends Named<
  typeof listWebhookEventsResultSchemaDefinition
> {}
export const listWebhookEventsResultSchema: ListWebhookEventsResultSchema =
  listWebhookEventsResultSchemaDefinition;
export type ListWebhookEventsResult = z.infer<typeof listWebhookEventsResultSchema>;
