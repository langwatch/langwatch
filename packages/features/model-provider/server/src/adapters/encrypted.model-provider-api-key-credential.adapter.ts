import { createLogger } from "@langwatch/observability";
import {
  ModelProviderCredentialCodec,
  type ModelProviderCredentialCipherPort,
} from "../ports/model-provider.port";

const logger = createLogger("langwatch:model-provider:credentials");

/**
 * How a ModelProvider's `customKeys` column read back.
 */
export interface CustomKeysRead {
  state: "absent" | "read" | "unreadable";
  keys: Record<string, unknown>;
}

const ABSENT: CustomKeysRead = { state: "absent", keys: {} };
const UNREADABLE: CustomKeysRead = { state: "unreadable", keys: {} };

/**
 * A credential bag is a plain object. `JSON.parse` also answers null, arrays, numbers and
 * strings for perfectly valid JSON, and a caller that indexes one of those throws where it
 * expected a missing key, so anything else reads as unreadable.
 */
function isKeyBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a ModelProvider's `customKeys` column.
 */

/** Decrypts one stored value and reads it as JSON. */
function parseDecrypted(raw: string, cipher: ModelProviderCredentialCipherPort): CustomKeysRead {
  let plaintext: string;
  try {
    plaintext = cipher.decrypt(raw);
  } catch (error) {
    // The error NAME only: a cipher that refuses a value may quote it, and the
    // value here is a customer's credential.
    logger.warn(
      {
        errorName: error instanceof Error ? error.name : "unknown",
        encryptedLength: raw.length,
      },
      "a model provider's custom keys would not decrypt; reading it as unreadable",
    );
    return UNREADABLE;
  }
  try {
    const parsed: unknown = JSON.parse(plaintext);
    return isKeyBag(parsed) ? { state: "read", keys: parsed } : UNREADABLE;
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

/**
 * The stored form of a provider's credentials: encrypted JSON, one column.
 */
export class EncryptedModelProviderCredentialAdapter extends ModelProviderCredentialCodec {
  static readCustomKeys(raw: unknown, cipher: ModelProviderCredentialCipherPort): CustomKeysRead {
    if (raw === null || raw === undefined) return ABSENT;
    if (typeof raw === "object") {
      return isKeyBag(raw) ? { state: "read", keys: raw } : UNREADABLE;
    }
    if (typeof raw !== "string") return UNREADABLE;
    return parseDecrypted(raw, cipher);
  }

  static create(input: {
    cipher: ModelProviderCredentialCipherPort;
  }): EncryptedModelProviderCredentialAdapter {
    return new EncryptedModelProviderCredentialAdapter(input.cipher);
  }

  private constructor(private readonly cipher: ModelProviderCredentialCipherPort) {
    super();
  }

  encode(value: Record<string, unknown> | null): unknown {
    return value === null ? null : this.cipher.encrypt(JSON.stringify(value));
  }

  tryDecode(value: unknown): Record<string, unknown> | null {
    const parsed = EncryptedModelProviderCredentialAdapter.readCustomKeys(value, this.cipher);
    return parsed.state === "read" ? parsed.keys : null;
  }
}
