import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretEncryption } from "../app/secret.app.ts";

/**
 * The at-rest format for stored secrets: AES-256-GCM under a 32-byte key,
 * written as `iv:ciphertext:authTag` (hexadecimal). Lives here beside the
 * service to avoid external cipher dependencies. Format is verified cross-suite
 * with platform/app/src/utils/encryption.ts to prevent drift. Key source is
 * caller-provided (not this class's concern).
 */
export class AesGcmSecretEncryptionAdapter implements SecretEncryption {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_BYTES = 32;
  private static readonly IV_BYTES = 12;

  /**
   * Refuses a key that is not 32 bytes of hex.
   *
   * The check is here, at construction, rather than at the first `encrypt`:
   * a composition root that was handed a truncated or rotated-to-garbage key
   * should fail while it is still booting, not on the first customer request
   * that happens to touch a secret.
   */
  static create(options: { key: string }): AesGcmSecretEncryptionAdapter {
    const key = new Uint8Array(Buffer.from(options.key, "hex"));
    if (key.length !== AesGcmSecretEncryptionAdapter.KEY_BYTES) {
      throw new Error("Stored-secret encryption requires a 32-byte hex key.");
    }
    return new AesGcmSecretEncryptionAdapter(key);
  }

  private constructor(private readonly key: Uint8Array) {
  }

  encrypt(value: string): string {
    const iv = randomBytes(AesGcmSecretEncryptionAdapter.IV_BYTES);
    const cipher = createCipheriv(
      AesGcmSecretEncryptionAdapter.ALGORITHM,
      this.key,
      new Uint8Array(iv),
    );

    let encrypted = cipher.update(value, "utf8", "hex");
    encrypted += cipher.final("hex");

    return `${iv.toString("hex")}:${encrypted}:${cipher.getAuthTag().toString("hex")}`;
  }

  /**
   * Reads a value back, with separate error messages for invalid format (never written
   * by this cipher) vs. failed auth tag (wrong key or tampering). Never echoes the input
   * since it's a customer credential.
   */
  decrypt(value: string): string {
    const [ivHex, encryptedData, authTagHex] = value.split(":");
    if (!ivHex || !encryptedData || !authTagHex) {
      throw new Error("Invalid encrypted string format");
    }

    try {
      const decipher = createDecipheriv(
        AesGcmSecretEncryptionAdapter.ALGORITHM,
        this.key,
        new Uint8Array(Buffer.from(ivHex, "hex")),
      );
      decipher.setAuthTag(new Uint8Array(Buffer.from(authTagHex, "hex")));

      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch {
      throw new Error("Failed to decrypt: Data may be corrupted or tampered with");
    }
  }
}
