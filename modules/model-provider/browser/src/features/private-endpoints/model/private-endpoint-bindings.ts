/** What the private endpoints page says and reads back (ADR-203). */
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import type { PrivateModelEndpointStatus } from "@langwatch/model-provider-contract";

export const PRIVATE_ENDPOINT_STATUS_LABELS: Record<PrivateModelEndpointStatus, string> = {
  in_use: "In use",
  unbound: "Unbound",
};

/** The grant the page and every change on it ask. */
export const PRIVATE_ENDPOINTS_MANAGE_PERMISSION = "organization:manage";

/** What a binding form refuses, keyed by the field it shows the message under. */
export type BindingFieldErrors = { hostname?: string };

/** The first `meta.fieldErrors` message for each field this form shows, from any transport. */
export function bindingFieldErrors(error: unknown): BindingFieldErrors {
  const meta =
    readHandledError(error)?.meta ?? (error as { meta?: Record<string, unknown> } | null)?.meta;
  const fieldErrors = meta?.fieldErrors as Record<string, unknown> | undefined;
  const refusal = fieldErrors?.hostname;
  const message: unknown = Array.isArray(refusal) ? refusal[0] : refusal;
  return typeof message === "string" ? { hostname: message } : {};
}
