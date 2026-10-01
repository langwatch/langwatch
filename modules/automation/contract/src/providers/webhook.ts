import {
  findWebhookUrlProblemMessage,
  sanitizeWebhookHeaders,
  webhookMethodSchema,
  type WebhookMethod,
} from "@langwatch/webhook-contract";
import { z } from "zod";

import type { PreviewEnvelope, SharedDef } from "../provider-types.ts";

/** The `Content-Type` a delivery announces also decides the body's treatment: JSON is
 *  rendered, parsed and re-serialized; any other type is sent as it renders. Its own
 *  field, not a header row, because header values are secrets that never read back. */
export const DEFAULT_WEBHOOK_CONTENT_TYPE = "application/json";

/** JSON semantics key off the declared type: `application/json` and any `+json`
 *  structured suffix (RFC 6839). Everything else is sent as it renders. */
export function isJsonWebhookContentType(contentType: string): boolean {
  const media = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return media === "application/json" || media.endsWith("+json");
}

/** RFC 7231 media type: `type/subtype`, optionally followed by parameters. */
const MEDIA_TYPE_RX =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+(\s*;\s*\S[^\r\n]*)?$/;

/** Whether a Content-Type is an admissible media type. */
export function isWebhookContentType(value: string): boolean {
  return MEDIA_TYPE_RX.test(value.trim());
}

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
  /** NULL = the framework default envelope for a JSON content type, an empty body otherwise. */
  bodyTemplate: z.string().nullable().default(null),
  /** Absent or empty means JSON, what every webhook automation was before the field existed. */
  contentType: z
    .string()
    .trim()
    .default(DEFAULT_WEBHOOK_CONTENT_TYPE)
    .transform((value) => (value === "" ? DEFAULT_WEBHOOK_CONTENT_TYPE : value))
    .refine(isWebhookContentType, "Enter a media type, like application/json or text/plain."),
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
  description: "Send a request with a body you shape to your own endpoint when a trace matches.",
  alertDescription: "Send a request with a body you shape to your own endpoint when it fires.",
  actionParamsSchema: webhookActionParamsSchema,
};

export default definition;
