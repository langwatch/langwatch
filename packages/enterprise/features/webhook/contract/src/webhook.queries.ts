import { z } from "zod";
import { webhookEnvelopeSchema } from "./webhook";

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
