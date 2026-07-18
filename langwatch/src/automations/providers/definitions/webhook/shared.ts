import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { PreviewEnvelope, SharedDef } from "../../types";

export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH"] as const;

/**
 * Sentinel a header VALUE carries on the wire to mean "keep the saved value".
 * Header values are secrets (Authorization, API keys): they are encrypted at
 * rest and never returned to the client (ADR-040 §3, same discipline as
 * `SLACK_BOT_TOKEN_KEPT`). Reads echo names with this sentinel as the value;
 * saves and test fires resolve it against the stored ciphertext server-side.
 */
export const WEBHOOK_HEADER_VALUE_KEPT = "__kept__";
export const webhookMethodSchema = z.enum(WEBHOOK_METHODS);
export type WebhookMethod = z.infer<typeof webhookMethodSchema>;

/**
 * Headers the customer cannot set: connection-shape headers the HTTP stack
 * owns, plus every header LangWatch injects itself (the test-fire marker must
 * be non-suppressible, ADR-040 §1). Compared case-insensitively; the
 * `x-langwatch-` prefix is reserved wholesale.
 */
const RESERVED_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
]);
const RESERVED_HEADER_PREFIX = "x-langwatch-";

export function isReservedWebhookHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    RESERVED_HEADER_NAMES.has(lower) || lower.startsWith(RESERVED_HEADER_PREFIX)
  );
}

/** Drops reserved keys and entries with empty names/values. Header values are
 *  stripped of CR/LF so a stored header can never smuggle a second one. */
export function sanitizeWebhookHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim();
    if (!key || isReservedWebhookHeader(key)) continue;
    const clean = value.replace(/[\r\n\0]+/g, " ").trim();
    if (!clean) continue;
    out[key] = clean;
  }
  return out;
}

/**
 * Redact a header record for the delivery log: which headers were sent is kept
 * (an operator debugging a 401 needs to see `Authorization` was present), but
 * every custom VALUE is secret regardless of its name. Masking all values keeps
 * innocently named credentials such as `X-Access-Code` out of control-plane
 * Postgres (ADR-040 §6).
 */
export function redactHeadersForLog(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    out[name] = "***";
  }
  return out;
}

/**
 * Shape check for the destination URL: https only, a real host, and the
 * default port (ADR-040 §4 — `https://internal:6379` probes are rejected at
 * authoring time; the real SSRF gate runs again at dispatch).
 */
export function validateWebhookUrlShape(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter a valid URL.";
  }
  if (parsed.protocol !== "https:") {
    return "The webhook URL must use https.";
  }
  if (!parsed.hostname) {
    return "The webhook URL needs a host.";
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    return "Only the default https port (443) is allowed.";
  }
  if (parsed.username || parsed.password) {
    return "The webhook URL cannot carry credentials.";
  }
  return null;
}

export const webhookActionParamsSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "A webhook URL is required.")
    .superRefine((url, ctx) => {
      const problem = validateWebhookUrlShape(url);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  method: webhookMethodSchema.default("POST"),
  /** Static custom headers (ADR-040 §1). Reserved keys are stripped on save.
   *  This is the WIRE shape: a value may be `WEBHOOK_HEADER_VALUE_KEPT`,
   *  resolved server-side against the stored ciphertext. At rest the record
   *  is encrypted into `headersEncrypted` (see `secret.ts`) — plaintext
   *  header values never persist and never return to the client. */
  headers: z
    .record(z.string(), z.string())
    .default({})
    .transform(sanitizeWebhookHeaders),
  /** Liquid JSON body source. NULL = the framework default envelope. Stored
   *  inside `actionParams` (not a Trigger template column) — ADR-040 §1. */
  bodyTemplate: z.string().nullable().default(null),
});

export type WebhookActionParams = z.infer<typeof webhookActionParamsSchema>;

/** The render-time preview shape this provider's ConfigForm consumes: the
 *  request the dispatch would make, with the rendered JSON body. */
export interface WebhookPreview extends PreviewEnvelope {
  channel: "webhook";
  payload: {
    method: WebhookMethod;
    url: string;
    body: string;
  };
}

const def: SharedDef = {
  action: TriggerAction.SEND_WEBHOOK,
  category: "notify",
  label: "Webhook",
  description: "Send a JSON payload to your own endpoint when a trace matches.",
  alertDescription:
    "Send a JSON payload to your own endpoint when the alert fires.",
  actionParamsSchema: webhookActionParamsSchema,
};

export default def;
