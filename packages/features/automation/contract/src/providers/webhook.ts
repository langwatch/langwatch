import { z } from "zod";
import type { PreviewEnvelope, SharedDef } from "../provider-types";

export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH"] as const;
export const WEBHOOK_HEADER_VALUE_KEPT = "__kept__";
export const webhookMethodSchema = z.enum(WEBHOOK_METHODS);
export type WebhookMethod = z.infer<typeof webhookMethodSchema>;

const RESERVED_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
]);
const RESERVED_HEADER_PREFIX = "x-langwatch-";
const HEADER_NAME_TOKEN_RX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isReservedWebhookHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return RESERVED_HEADER_NAMES.has(lower) || lower.startsWith(RESERVED_HEADER_PREFIX);
}

export function sanitizeWebhookHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim();
    if (!key || !HEADER_NAME_TOKEN_RX.test(key)) continue;
    if (isReservedWebhookHeader(key)) continue;
    const cleanValue = value.replace(/[\r\n\0]+/g, " ").trim();
    if (!cleanValue) continue;
    output[key] = cleanValue;
  }
  return output;
}

export type WebhookUrlProblemCode = "invalid_url" | "scheme" | "host" | "port" | "credentials";
export interface WebhookUrlProblem {
  code: WebhookUrlProblemCode;
  message: string;
}

type ParsedUrl = {
  username: string;
  password: string;
  hostname: string;
  protocol: string;
  port: string;
};
type UrlConstructor = new (url: string) => ParsedUrl;

export function inspectWebhookUrlShape(
  url: string,
  { allowInsecureOrigin = false }: { allowInsecureOrigin?: boolean } = {},
): WebhookUrlProblem | null {
  let parsed: ParsedUrl;
  try {
    const Url = (globalThis as { URL?: UrlConstructor }).URL;
    if (!Url) {
      return { code: "invalid_url", message: "Enter a valid URL." };
    }
    parsed = new Url(url);
  } catch {
    return { code: "invalid_url", message: "Enter a valid URL." };
  }
  const schemeAllowed = allowInsecureOrigin
    ? parsed.protocol === "https:" || parsed.protocol === "http:"
    : parsed.protocol === "https:";
  if (!schemeAllowed) {
    return { code: "scheme", message: "The webhook URL must use https." };
  }
  if (!parsed.hostname) {
    return { code: "host", message: "The webhook URL needs a host." };
  }
  if (!allowInsecureOrigin && parsed.port !== "" && parsed.port !== "443") {
    return {
      code: "port",
      message: "Only the default https port (443) is allowed.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      code: "credentials",
      message: "The webhook URL cannot carry credentials.",
    };
  }
  return null;
}

export function validateWebhookUrlShape(url: string): string | null {
  return inspectWebhookUrlShape(url)?.message ?? null;
}

export const webhookActionParamsSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "A webhook URL is required.")
    .superRefine((url, context) => {
      const problem = validateWebhookUrlShape(url);
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
