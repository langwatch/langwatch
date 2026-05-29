import { decrypt, encrypt } from "~/utils/encryption";

/**
 * Pull-mode ingestion sources carry live upstream secrets under
 * `parserConfig.credentials` (AWS access keys for s3_polling, a Bearer
 * token for http_polling, the Anthropic workspace key for
 * claude_compliance, the Microsoft client secret for copilot_studio).
 * Those must never sit in the JSONB column as plaintext, so the subtree
 * is wrapped in a single AES-256-GCM envelope (the shared
 * `~/utils/encryption` app-key helper) before persistence and unwrapped
 * only at puller dispatch.
 *
 * The encrypted value is a string tagged with `ENCRYPTED_PREFIX` so it is
 * unambiguously distinguishable from a legacy plaintext object — readers
 * tolerate both shapes, which lets the encryption roll out before the
 * re-encrypt migration touches already-landed rows.
 */
const ENCRYPTED_PREFIX = "enc:v1:";

function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Return a copy of `parserConfig` with its `credentials` subtree encrypted.
 * Idempotent (an already-encrypted value is left untouched) and a no-op
 * when there are no credentials to protect.
 */
export function encryptParserConfigCredentials(
  parserConfig: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!parserConfig || typeof parserConfig !== "object") return parserConfig;
  const creds = parserConfig.credentials;
  if (creds === undefined || creds === null || isEncrypted(creds)) {
    return parserConfig;
  }
  return {
    ...parserConfig,
    credentials: ENCRYPTED_PREFIX + encrypt(JSON.stringify(creds)),
  };
}

/**
 * Resolve the plaintext credentials object for puller dispatch. Accepts
 * the encrypted envelope written by `encryptParserConfigCredentials` and,
 * for backward compatibility, a legacy plaintext object that predates the
 * re-encrypt migration.
 */
export function decryptCredentials(raw: unknown): Record<string, string> {
  if (isEncrypted(raw)) {
    const parsed: unknown = JSON.parse(
      decrypt(raw.slice(ENCRYPTED_PREFIX.length)),
    );
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  }
  if (raw && typeof raw === "object") {
    return raw as Record<string, string>;
  }
  return {};
}

/** Encrypt a standalone credential value (UserIngestionBinding). */
export function encryptCredential(value: unknown): string {
  if (isEncrypted(value)) return value;
  return ENCRYPTED_PREFIX + encrypt(JSON.stringify(value));
}

/** Decrypt a standalone credential value, tolerating legacy plaintext. */
export function decryptCredential(raw: unknown): unknown {
  if (isEncrypted(raw)) {
    return JSON.parse(decrypt(raw.slice(ENCRYPTED_PREFIX.length)));
  }
  return raw;
}
