import { type SerializedHandledError } from "@langwatch/handled-error";
import {
  type ModelProviderCredentialVerdict,
  type ModelProviderUncheckedReason,
} from "@langwatch/model-provider-contract";

export const verified = (): ModelProviderCredentialVerdict => ({
  outcome: "verified",
  valid: true,
});

export const refused = (domainError: SerializedHandledError): ModelProviderCredentialVerdict => ({
  outcome: "refused",
  valid: false,
  domainError,
});

export const unchecked = (
  reason: ModelProviderUncheckedReason,
): ModelProviderCredentialVerdict => ({
  outcome: "unchecked",
  valid: true,
  reason,
});

/** Longest upstream explanation we keep for the server-side log line. */
export const MAX_UPSTREAM_DETAIL_LENGTH = 300;

/** What a Google `ErrorInfo` reason says about the key; the probe service maps it to an error. */
type GeminiRefusalKind = "key_invalid" | "service_disabled" | "key_restricted" | "unmapped";

const GEMINI_REASON_KINDS = new Map<string, GeminiRefusalKind>([
  ["API_KEY_INVALID", "key_invalid"],
  ["SERVICE_DISABLED", "service_disabled"],
  ["API_KEY_SERVICE_BLOCKED", "key_restricted"],
  ["API_KEY_HTTP_REFERRER_BLOCKED", "key_restricted"],
  ["API_KEY_IP_ADDRESS_BLOCKED", "key_restricted"],
  ["API_KEY_ANDROID_APP_BLOCKED", "key_restricted"],
  ["API_KEY_IOS_APP_BLOCKED", "key_restricted"],
]);

/**
 * Only `API_KEY_INVALID` means the key is wrong; the rest are project/restriction problems.
 * @see https://cloud.google.com/apis/design/errors
 */
export function geminiRefusalKind({ reason }: { reason: string }): GeminiRefusalKind {
  return GEMINI_REASON_KINDS.get(reason) ?? "unmapped";
}

/** The refusal as the provider described it, once we can read it. */
export type UpstreamRefusal = { message?: string; reason?: string; code?: string };

/**
 * Pulls the human-readable message out of the error shapes our providers
 * actually return. Google, OpenAI and Anthropic all nest it under `error`;
 * ElevenLabs uses `detail`.
 */
export function extractUpstreamMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const { error, message, detail } = body as Record<string, unknown>;

  const candidates = [
    (error as Record<string, unknown> | undefined)?.message,
    error,
    message,
    (detail as Record<string, unknown> | undefined)?.message,
    detail,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

/** Reads the OpenAI-style `error.code`, which Azure fills with e.g. `DeploymentNotFound`. */
export function extractUpstreamCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

/**
 * Whether Azure itself said the deployment is missing. A wrong endpoint path answers 404
 * too, before the key is looked at, so the status alone proves nothing.
 */
export function isAzureDeploymentNotFound({
  provider,
  status,
  code,
}: {
  provider: string;
  status: number;
  code: string | undefined;
}): boolean {
  return provider === "azure" && status === 404 && code === "DeploymentNotFound";
}

/** Reads Google's `google.rpc.ErrorInfo` reason out of `error.details[]`. */
export function extractUpstreamReason(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return undefined;

  const details = (error as Record<string, unknown>).details;
  if (!Array.isArray(details)) return undefined;

  for (const detail of details) {
    const reason = (detail as Record<string, unknown> | null)?.reason;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }

  return undefined;
}

/**
 * Strips the submitted key out of text we are about to show or log. Gemini
 * carries the key in the query string, and providers echo the offending
 * request back often enough that this cannot be left to chance.
 */
export function redactApiKey(text: string, apiKey: string): string {
  if (apiKey.length < 8) return text;

  const encoded = encodeURIComponent(apiKey);
  const forms = encoded === apiKey ? [apiKey] : [apiKey, encoded];

  return forms.reduce((redacted, form) => redacted.split(form).join("[redacted]"), text);
}
