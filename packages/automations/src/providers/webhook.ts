import { z } from "zod";
import { TriggerAction } from "../enums";
import type { PreviewEnvelope, SharedDef } from "./types";

export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH"] as const;

/**
 * Sentinel a stored SECRET carries on the wire to mean "keep the saved value".
 * Header values (Authorization, API keys) and the signing secret are all
 * secrets: they are encrypted at rest and never returned to the client
 * (ADR-040 §3, same discipline as `SLACK_BOT_TOKEN_KEPT`). Reads echo this
 * sentinel in place of every stored value; saves and test fires resolve it
 * against the stored ciphertext server-side.
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

/** RFC 7230 header-name token: dropping a smuggling attempt beats mangling it
 *  into a name (`X-Custom\r\nX-Injected: evil` → `X-CustomX-Injected: evil`)
 *  that the HTTP stack rejects at send time, poisoning every dispatch. */
const HEADER_NAME_TOKEN_RX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Drops reserved keys, entries with empty names/values, and names that are
 *  not valid header tokens. Values are stripped of CR/LF so a stored header
 *  can never smuggle a second one. */
export function sanitizeWebhookHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim();
    if (!key || !HEADER_NAME_TOKEN_RX.test(key)) continue;
    if (isReservedWebhookHeader(key)) continue;
    const clean = value.replace(/[\r\n\0]+/g, " ").trim();
    if (!clean) continue;
    out[key] = clean;
  }
  return out;
}

/** Which admission rule a URL fell foul of. Both webhook channels run this one
 *  check but publish their own wording for the outcome — the automations drawer
 *  speaks to a trigger author, the endpoints REST API to an integrator — so the
 *  decision travels as a code and each surface maps it to its own sentence. */
export type WebhookUrlProblemCode =
  | "invalid_url"
  | "scheme"
  | "host"
  | "port"
  | "credentials";

export interface WebhookUrlProblem {
  code: WebhookUrlProblemCode;
  /** The automations channel's author-facing sentence. */
  message: string;
}

/**
 * Shape check for the destination URL: https only, a real host, the default
 * port, and no credentials (ADR-040 §4 — `https://internal:6379` probes are
 * rejected at authoring time; the real SSRF gate runs again at dispatch).
 *
 * `allowInsecureOrigin` is the operator escape hatch for local development and
 * internal receivers: it relaxes the scheme and the port, which is what a
 * `http://receiver.internal:8080` endpoint needs. It does NOT relax the
 * credentials rule — userinfo in a webhook URL is never a working
 * configuration, only a way to smuggle a host past a reader.
 */
export function inspectWebhookUrlShape(
  url: string,
  { allowInsecureOrigin = false }: { allowInsecureOrigin?: boolean } = {},
): WebhookUrlProblem | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
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

/** The author-facing sentence for {@link inspectWebhookUrlShape}, or null when
 *  the URL is admissible. What the trigger drawer's form and its server-side
 *  schema both validate against. */
export function validateWebhookUrlShape(url: string): string | null {
  return inspectWebhookUrlShape(url)?.message ?? null;
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
  /**
   * Optional HMAC signing secret (ADR-040 §3). NULL means unsigned, which is
   * what every webhook automation was until this existed: one signing scheme
   * shipped with the endpoints platform and this channel never passed a
   * secret to it, so a receiver had no way to tell a LangWatch delivery from
   * anyone who learned the URL.
   *
   * Set it and deliveries carry `X-LangWatch-Signature: t=<unix>,v1=<hmac>`,
   * signed by the same implementation the endpoints platform uses. This is
   * the WIRE shape: a value may be `WEBHOOK_HEADER_VALUE_KEPT`, resolved
   * server-side against the stored ciphertext. At rest it is encrypted, like
   * the header values, and never returns to the client.
   */
  signingSecret: z.string().trim().nullable().optional(),
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
  alertDescription: "Send a JSON payload to your own endpoint when it fires.",
  actionParamsSchema: webhookActionParamsSchema,
};

export default def;
