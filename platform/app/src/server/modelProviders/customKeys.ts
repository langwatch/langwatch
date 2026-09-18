import { createLogger } from "@langwatch/observability";
import { EXACT_CREDENTIAL_FIELDS } from "~/utils/constants";
import { decrypt } from "~/utils/encryption";

const logger = createLogger("langwatch:modelProviders:customKeys");

/**
 * How a ModelProvider's `customKeys` column read back.
 *
 * `keys` is empty for every state except `read`, so a caller that fails closed
 * on missing credentials can use it and ignore the rest. `state` is there for
 * the callers that must act differently, because the three are not the same
 * thing:
 *
 * - `absent`: the column is null. The row stores no credentials, which is a
 *   configuration an operator can choose.
 * - `read`: the column decrypted and parsed. `keys` may still be empty, which
 *   is also a configuration an operator can choose.
 * - `unreadable`: the column holds a value that would not decrypt or parse.
 *   The credentials exist and cannot be used, which is an infrastructure
 *   failure, usually CREDENTIALS_SECRET changing after the row was written.
 */
export interface CustomKeysRead {
  state: "absent" | "read" | "unreadable";
  keys: Record<string, unknown>;
}

const ABSENT: CustomKeysRead = { state: "absent", keys: {} };
const UNREADABLE: CustomKeysRead = { state: "unreadable", keys: {} };

/**
 * A credential bag is a plain object. `JSON.parse` also answers null, arrays,
 * numbers and strings for perfectly valid JSON, and a caller that indexes one
 * of those throws where it expected a missing key, so anything else reads as
 * unreadable.
 */
function isKeyBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strips the whitespace around every credential in a bag, except the few
 * listed in {@link EXACT_CREDENTIAL_FIELDS}.
 *
 * A credential pasted from a terminal, a password manager or a wiki page
 * arrives with padding, and the padding survives into the column. Whether it
 * then breaks the provider depends on where the credential is spent, which is
 * why it can sit in a row for months looking harmless: a key in a query string
 * is percent-encoded and the provider ignores the padding, while the same key
 * in an HTTP header is refused before the request leaves the process. That is
 * how a provider reports "Connection works" on the settings page, which probes
 * `?key=`, while every evaluation against it fails with `Illegal header value`.
 *
 * A credential spent as a header or a query parameter means nothing different
 * for the whitespace around it, so it is stripped once here and no caller has
 * to ask. Stripping on the
 * way out of the column rather than on the way in is deliberate: rows written
 * before this existed are already padded, and healing them on read costs
 * nobody a re-paste or a backfill.
 *
 * Only strings are touched. The bag carries more than secrets — a Gemini
 * credential stores its project and location beside the key — and a value that
 * is not a string has no padding to lose.
 */
function trimCredentials(
  bag: Record<string, unknown>,
): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(bag)) {
    trimmed[name] =
      typeof value === "string" && !EXACT_CREDENTIAL_FIELDS.has(name)
        ? value.trim()
        : value;
  }
  return trimmed;
}

/**
 * Reads a ModelProvider's `customKeys` column.
 *
 * The column holds either an encrypted JSON string or, on rows written before
 * encryption, the object itself.
 *
 * Nothing here throws. A provider whose secrets cannot be read serves nothing,
 * and throwing would take an unrelated request down with it, so the failure is
 * reported in `state` instead. Reporting it matters because an empty bag and
 * an unreadable one look identical to a caller that only reads `keys`: on the
 * voice path the webhook answers 404 and the reconciler skips the session, so
 * the call settles as cost-unknown with no other signal that anything went
 * wrong. `decrypt` logs its own failures; a parse failure had none.
 */
export function readCustomKeys(raw: unknown): CustomKeysRead {
  if (raw === null || raw === undefined) return ABSENT;
  if (typeof raw === "object") {
    return isKeyBag(raw)
      ? { state: "read", keys: trimCredentials(raw) }
      : UNREADABLE;
  }
  if (typeof raw !== "string") return UNREADABLE;
  return parseDecrypted(raw);
}

/** Decrypts one stored value and reads it as JSON. */
function parseDecrypted(raw: string): CustomKeysRead {
  let plaintext: string;
  try {
    plaintext = decrypt(raw);
  } catch {
    // decrypt logs its own failures.
    return UNREADABLE;
  }
  try {
    const parsed: unknown = JSON.parse(plaintext);
    return isKeyBag(parsed)
      ? { state: "read", keys: trimCredentials(parsed) }
      : UNREADABLE;
  } catch (error) {
    // The error NAME only, never the error itself. A SyntaxError from
    // JSON.parse quotes the input it choked on, and the input here is the
    // decrypted secret, so logging the error would write a provider key into
    // the log line meant to warn that the key could not be read.
    logger.warn(
      {
        errorName: error instanceof Error ? error.name : "unknown",
        encryptedLength: raw.length,
      },
      "a model provider's custom keys decrypted to something that is not JSON; reading it as unreadable",
    );
    return UNREADABLE;
  }
}
