/**
 * The four members with no client behind them: they are built from a config
 * value and open nothing, so nothing here has a close.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Logger } from "@langwatch/observability";
import type { Clock, Encryption, SecretResolver, Telemetry } from "./members.ts";

/** The wall clock. A test swaps this member rather than the code that reads it. */
export function systemClock(): Clock {
  return { now: () => new Date() };
}

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const INITIALISATION_VECTOR_BYTES = 12;

/**
 * AES-256-GCM over a 32-byte key, written as
 * `<iv>.<authentication tag>.<ciphertext>` in base64url so a stored value
 * carries everything decryption needs but the key.
 */
export function aesEncryption(key: Uint8Array): Encryption {
  if (key.byteLength !== 32) {
    throw new Error(`The encryption key is ${key.byteLength} bytes, and AES-256 needs 32.`);
  }

  return {
    encrypt(plaintext) {
      const iv = randomBytes(INITIALISATION_VECTOR_BYTES);
      const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
    },
    decrypt(ciphertext) {
      const parts = ciphertext.split(".");
      const [iv, tag, body] = parts;
      if (parts.length !== 3 || iv === void 0 || tag === void 0 || body === void 0) {
        throw new Error("An encrypted value reads as <iv>.<tag>.<ciphertext>.");
      }
      const decipher = createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/**
 * The secrets this process was started with, already resolved through the
 * chain in @langwatch/secrets. Reading one this process was not given is a
 * refusal naming the key, never an empty string.
 */
export function resolvedSecrets(values: Readonly<Record<string, string>>): SecretResolver {
  const frozen = Object.freeze({ ...values });
  return {
    read(key) {
      const value = frozen[key];
      if (value === void 0 || value.length === 0) {
        throw new Error(`This process was started without the secret "${key}".`);
      }
      return value;
    },
    find: (key) => frozen[key],
  };
}

/** Counters and observations as structured records, until meters are wired. */
export function loggedTelemetry(logger: Logger): Telemetry {
  return {
    count(name, value = 1, attributes) {
      logger.debug({ metric: name, value, attributes }, "telemetry count");
    },
    observe(name, value, attributes) {
      logger.debug({ metric: name, value, attributes }, "telemetry observation");
    },
  };
}
