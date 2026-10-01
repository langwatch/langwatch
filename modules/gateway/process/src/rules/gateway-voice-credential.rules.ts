import { HandledError } from "@langwatch/handled-error";

/** The model-provider refusals meaning "no keys to read", which a voice read treats as absence. */
const MISSING_PROVIDER_KEYS_CODES: ReadonlySet<string> = new Set([
  "model_provider_not_found",
  "model_provider_custom_keys_missing",
]);

export function isMissingProviderKeys(error: unknown): boolean {
  return HandledError.isHandled(error) && MISSING_PROVIDER_KEYS_CODES.has(error.code);
}
