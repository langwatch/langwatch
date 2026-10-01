import { z } from "zod";

/** A single HTTP request to a customer URL, one attempt at a time (ADR-167 step 1). */

export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH"] as const;
/** A saved header value the author left unchanged; resolved before sending, never sent. */
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

export function findWebhookUrlProblem(
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

export function findWebhookUrlProblemMessage(url: string): string | null {
  return findWebhookUrlProblem(url)?.message ?? null;
}

/** Who asked for a request; it only groups ledger rows (automation reads its trigger's by it). */
export const webhookRequestSourceSchema = z.object({
  module: z.literal("automation"),
  ref: z.string(),
});
export type WebhookRequestSource = z.infer<typeof webhookRequestSourceSchema>;

/** One attempt: fenced, capped per project, signed, sent, classified and recorded. */
export const webhookSendRequestSchema = z.object({
  projectId: z.string(),
  url: z.string(),
  method: webhookMethodSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string(),
  /** What the body is, sent as `Content-Type`; absent sends JSON. */
  contentType: z.string().optional(),
  /** Newest first; each yields one `v1` in `X-LangWatch-Signature`. */
  signingSecrets: z.array(z.string()).readonly().optional(),
  /** Stable across every retry of one dispatch; sent as `X-LangWatch-Event-Id`. */
  dispatchId: z.string(),
  /** Woven into refusal messages, e.g. `Webhook for trigger "Name"`. */
  label: z.string(),
  source: webhookRequestSourceSchema,
  /** An author's test: marked by header, outside the cap and never filed in the ledger. */
  testFire: z.boolean().optional(),
});
export type WebhookSendRequest = z.infer<typeof webhookSendRequestSchema>;

export const webhookSendRequestResultSchema = z.object({
  status: z.number().int(),
  dispatchId: z.string(),
});
export type WebhookSendRequestResult = z.infer<typeof webhookSendRequestResultSchema>;

export const webhookRequestOutcomeSchema = z.enum(["success", "retryable", "terminal", "pending"]);

/** The receiver's side of a failed attempt; the request itself is never kept. */
export const webhookRequestFailureResponseSchema = z.object({
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  retryAfterMs: z.number().optional(),
});
export type WebhookRequestFailureResponse = z.infer<typeof webhookRequestFailureResponseSchema>;

/** One recorded attempt of {@link webhookSendRequestSchema}, newest first. */
export const webhookRequestDeliverySchema = z.object({
  id: z.string(),
  ref: z.string(),
  dispatchId: z.string(),
  responseStatus: z.number().nullable(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  response: webhookRequestFailureResponseSchema.nullable(),
  outcome: webhookRequestOutcomeSchema,
  firedAt: z.date(),
});
export type WebhookRequestDelivery = z.infer<typeof webhookRequestDeliverySchema>;
