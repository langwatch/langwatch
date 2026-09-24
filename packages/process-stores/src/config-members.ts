/**
 * The four members with no client behind them: they are built from a config
 * value and open nothing, so nothing here has a close.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { Clock, Encryption, SecretResolver, Telemetry } from "./members.ts";

/** The wall clock. A test swaps this member rather than the code that reads it. */
export function systemClock(): Clock {
  return { now: () => nowInstant() };
}

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const INITIALISATION_VECTOR_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;

type SealedParts = Readonly<{ iv: Buffer; tag: Buffer; body: Buffer }>;

/** main's `ivhex:cipherhex:taghex`, and the base64url `iv.tag.body` this branch once wrote. */
function sealedParts(sealed: string): SealedParts {
  const hex = sealed.includes(":");
  const parts = sealed.split(hex ? ":" : ".");
  const [iv, body, tag] = hex ? parts : [parts[0], parts[2], parts[1]];
  if (parts.length !== 3 || !iv || !tag || body === void 0) {
    throw new Error("An encrypted value reads as <iv>:<ciphertext>:<tag> in hex.");
  }
  const encoding = hex ? "hex" : "base64url";
  return {
    iv: Buffer.from(iv, encoding),
    tag: Buffer.from(tag, encoding),
    body: Buffer.from(body, encoding),
  };
}

/**
 * AES-256-GCM over a 32-byte key, sealed exactly as main's
 * `platform/app/src/utils/encryption.ts` did, so either side reads the other's
 * rows (ADR-155). The value never appears in a refusal.
 */
export function aesEncryption(key: Uint8Array): Encryption {
  if (key.byteLength !== 32) {
    throw new Error(
      `The encryption key decodes to ${key.byteLength} bytes of hex, and AES-256 needs 32.`,
    );
  }

  return {
    encrypt(plaintext) {
      const iv = randomBytes(INITIALISATION_VECTOR_BYTES);
      const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [iv, body, cipher.getAuthTag()].map((part) => part.toString("hex")).join(":");
    },
    decrypt(ciphertext) {
      const { iv, tag, body } = sealedParts(ciphertext);
      if (
        iv.byteLength !== INITIALISATION_VECTOR_BYTES ||
        tag.byteLength !== AUTHENTICATION_TAG_BYTES
      ) {
        throw new Error("An encrypted value carries a malformed iv or authentication tag.");
      }
      try {
        const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
          authTagLength: AUTHENTICATION_TAG_BYTES,
        });
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      } catch {
        throw new Error(
          "Failed to decrypt: the value is corrupted, tampered with, or sealed under another key.",
        );
      }
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
