import {
  findWebhookUrlProblemMessage,
  sanitizeWebhookHeaders,
  webhookMethodSchema,
  type WebhookMethod,
} from "@langwatch/webhook-contract";
import { z } from "zod";

import type { PreviewEnvelope, SharedDef } from "../provider-types.ts";

export const webhookActionParamsSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "A webhook URL is required.")
    .superRefine((url, context) => {
      const problem = findWebhookUrlProblemMessage(url);
      if (problem) context.addIssue({ code: "custom", message: problem });
    }),
  method: webhookMethodSchema.default("POST"),
  headers: z.record(z.string(), z.string()).default({}).transform(sanitizeWebhookHeaders),
  bodyTemplate: z.string().nullable().default(null),
  signingSecret: z.string().trim().nullable().optional(),
});
export type WebhookActionParams = z.infer<typeof webhookActionParamsSchema>;

export interface WebhookPreview extends PreviewEnvelope {
  channel: "webhook";
  payload: {
    method: WebhookMethod;
    url: string;
    body: string;
  };
}

const definition: SharedDef = {
  action: "SEND_WEBHOOK",
  category: "notify",
  label: "Webhook",
  description: "Send a JSON payload to your own endpoint when a trace matches.",
  alertDescription: "Send a JSON payload to your own endpoint when the alert fires.",
  actionParamsSchema: webhookActionParamsSchema,
};

export default definition;
