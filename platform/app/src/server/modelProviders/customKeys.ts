import { createLogger } from "@langwatch/observability";
import { decrypt } from "~/utils/encryption";

const logger = createLogger("langwatch:modelProviders:customKeys");

/**
 * Reads a ModelProvider's `customKeys` column into a plain map.
 *
 * The column holds either an encrypted JSON string or, on rows written
 * before encryption, the object itself. A value that will not decrypt or
 * parse reads as no keys at all: a provider whose secrets cannot be read
 * serves nothing, and throwing here would take an unrelated request down
 * with it.
 *
 * The empty map is logged because callers cannot tell it apart from a
 * provider that simply has no custom keys, and the two have very different
 * consequences on the voice path: the webhook answers 404 and the reconciler
 * skips the session, so the call settles as cost-unknown with no other
 * signal that anything went wrong. `decrypt` logs its own failures; a parse
 * failure had none.
 */
export function decryptCustomKeys(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    let plaintext: string;
    try {
      plaintext = decrypt(raw);
    } catch {
      return {};
    }
    try {
      return JSON.parse(plaintext) as Record<string, unknown>;
    } catch (error) {
      // The ciphertext length only. Never the value, and never the plaintext.
      logger.warn(
        { error, encryptedLength: raw.length },
        "a model provider's custom keys decrypted to something that is not JSON; reading it as no keys",
      );
      return {};
    }
  }
  return {};
}
