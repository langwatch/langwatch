import type { SecretsChain } from "@langwatch/secrets";

/**
 * The pepper chain `ApiKeyModule.secrets` resolves, in its order (first set wins), or seeds never
 * verify. Absent is valid here, and never minted (random rows would not verify).
 */
export const API_KEY_PEPPER_KEYS = [
  "API_KEY_PEPPER",
  "CREDENTIALS_SECRET",
  "NEXTAUTH_SECRET",
] as const;

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
 * Resolves the pepper through the runner's chain, the same ordered sources
 * every process boots with (ADR-132), so the seed writes hashes the
 * applications verify.
 */
export async function resolveApiKeyPepper({
  chain,
}: {
  chain: SecretsChain;
}): Promise<ApiKeyPepperResolution> {
  const resolved: Record<string, string> = {};

  for (const key of API_KEY_PEPPER_KEYS) {
    const value = await chain.fetch(key);
    if (value !== undefined) resolved[key] = value;
  }

  return apiKeyPepperFrom({ environment: resolved });
}
