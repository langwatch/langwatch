import { SecretsChain } from "@langwatch/secrets";

/**
 * The pepper seeded API-key hashes are keyed under, the same name api-key.config.ts declares, or
 * seeds never verify. `dev: optional`: absent is valid, and never minted here (random rows would
 * not verify).
 */
export const API_KEY_PEPPER_KEYS = ["API_KEY_PEPPER"] as const;

/** The pepper, or the keys that were absent when there was none. */
export type ApiKeyPepperResolution = Readonly<
  { pepper: string; absent: readonly [] } | { pepper: undefined; absent: readonly string[] }
>;

/**
 * Picks the pepper out of an already-resolved environment. Split from the
 * resolution below so the choice — first key wins, absence is named rather
 * than thrown — is testable without a secret source.
 */
export function apiKeyPepperFrom({
  environment,
}: {
  environment: Readonly<Record<string, unknown>>;
}): ApiKeyPepperResolution {
  for (const key of API_KEY_PEPPER_KEYS) {
    const value = environment[key];
    if (typeof value === "string" && value !== "") return { pepper: value, absent: [] };
  }

  return { pepper: void 0, absent: API_KEY_PEPPER_KEYS };
}

/**
 * Resolves the pepper through the same ordered source chain every process
 * boots with (ADR-132), so the seed writes hashes the applications verify —
 * by the time this runs, `--env-file-if-exists` has loaded the workspace `.env`.
 */
export async function resolveApiKeyPepper({
  source,
}: {
  source: Readonly<Record<string, unknown>>;
}): Promise<ApiKeyPepperResolution> {
  const environment = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, typeof value === "string" ? value : void 0]),
  );
  const chain = SecretsChain.start({ environment }).withEnv();
  const resolved: Record<string, string> = {};

  for (const key of API_KEY_PEPPER_KEYS) {
    const value = await chain.fetch(key);
    if (value !== undefined) resolved[key] = value;
  }

  return apiKeyPepperFrom({ environment: resolved });
}
