import { decrypt, encrypt } from "~/utils/encryption";

/**
 * Pull-mode ingestion sources carry live upstream secrets under
 * `parserConfig.credentials` (AWS access keys for s3_polling, a Bearer
 * token for http_polling, the Anthropic workspace key for
 * claude_compliance, the Microsoft client secret for microsoft_365_audit).
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
 * Whether a value is one of our sealed envelopes rather than a fresh secret.
 *
 * Callers use this to refuse a client-supplied envelope. Re-encryption is
 * idempotent by design (so a rollout can re-save an already-encrypted row
 * safely), and that same property is what would let someone hand an envelope
 * they cannot open straight back to us alongside a changed destination. A
 * write path that accepts one is letting a caller keep a secret it never
 * proved it knows.
 */
export function isEncryptedCredentials(value: unknown): value is string {
  return isEncrypted(value);
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
