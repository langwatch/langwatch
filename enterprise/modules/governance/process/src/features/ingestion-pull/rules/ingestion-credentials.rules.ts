// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What main wrote ahead of a sealed `parserConfig.credentials`: the stored form, never a secret. */
export const SEALED_CREDENTIALS_PREFIX = "enc:v1:";

/** Whether a value is credentials in their stored form, which no caller may submit or use. */
export function isSealedCredentials(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SEALED_CREDENTIALS_PREFIX);
}

/**
 * The credential bag a provider call uses. A value still in its stored form is one the store
 * could not open, so it is refused rather than read as an empty bag.
 */
export function credentialsOf(raw: unknown): Record<string, string> {
  if (isSealedCredentials(raw)) {
    throw new Error(
      "The source's stored credentials could not be opened: corrupted, tampered with, or sealed under another key.",
    );
  }

  return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
}

/**
 * The config as a save itself sent it. An edit that resent no secret carries the stored one across,
 * judged when it was saved, so it is no credential of this save's own (the Azure bill guard).
 */
export function credentialsAsSent({
  parserConfig,
  existing,
  resentCredentials,
}: {
  parserConfig: Record<string, unknown>;
  existing: unknown;
  resentCredentials: boolean;
}): Record<string, unknown> {
  if (existing === undefined || resentCredentials) return parserConfig;

  return Object.fromEntries(Object.entries(parserConfig).filter(([key]) => key !== "credentials"));
}
