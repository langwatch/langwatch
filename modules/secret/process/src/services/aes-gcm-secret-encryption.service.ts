import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { SecretEncryption } from "../app/secret.app.ts";

/**
 * Stores AES-256-GCM as hex `iv:ciphertext:authTag`; keep compatible with
 * platform/app/src/utils/encryption.ts.
 */
export class AesGcmSecretEncryptionService implements SecretEncryption {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_BYTES = 32;
  private static readonly IV_BYTES = 12;

  /**
   * Validate at construction so a bad or rotated key fails boot instead of the
   * first customer request.
   */
  static create(options: { key: string }): AesGcmSecretEncryptionService {
    const key = new Uint8Array(Buffer.from(options.key, "hex"));
    if (key.length !== AesGcmSecretEncryptionService.KEY_BYTES) {
      throw new Error("Stored-secret encryption requires a 32-byte hex key.");
    }
    return new AesGcmSecretEncryptionService(key);
  }

  private constructor(private readonly key: Uint8Array) {}

  encrypt(value: string): string {
    const iv = randomBytes(AesGcmSecretEncryptionService.IV_BYTES);
    const cipher = createCipheriv(
      AesGcmSecretEncryptionService.ALGORITHM,
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
        AesGcmSecretEncryptionService.ALGORITHM,
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
