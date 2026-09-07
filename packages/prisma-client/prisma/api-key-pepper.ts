import { SecretEnvironmentService } from "@langwatch/secrets";

/**
 * The hashing and encryption pepper the seed writes API-key hashes under, in
 * the order the applications read it.
 *
 * Both keys are `dev: optional` in the secret registry (packages/secrets/
 * keys.json), so a checkout that has neither is a configured state, not a
 * broken one — and it must not stop `haven up`. The value cannot be minted
 * here either: it keys stored hashes and the AES-GCM envelope around seeded
 * provider credentials, so a per-run random pepper would write rows the
 * running applications can never verify or decrypt.
 */
export const API_KEY_PEPPER_KEYS = ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"] as const;

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
 * boots with (ADR-132), so the seed writes hashes the applications verify.
 * The chain reads the process environment, which is where `--env-file-if-
 * exists` has already put the workspace `.env` by the time this runs.
 */
export async function resolveApiKeyPepper({
  source,
}: {
  source: Readonly<Record<string, unknown>>;
}): Promise<ApiKeyPepperResolution> {
  const { environment } = await SecretEnvironmentService.create({ source }).resolve();

  return apiKeyPepperFrom({ environment });
}
