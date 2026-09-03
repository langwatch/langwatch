import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SecretEncryptionPort } from "../ports/secret.port";

/**
 * The at-rest format for a stored secret: AES-256-GCM under a 32-byte key,
 * written as `iv:ciphertext:authTag`, every part hexadecimal.
 *
 * It lives here, beside the port it satisfies, so that a process composing
 * this feature's service brings no cipher of its own. It is a WIRE FORMAT
 * rather than a utility: rows the platform app wrote are read back by the API
 * process, so the failure mode of getting it wrong is a customer credential
 * that will not decrypt, found long after the write.
 *
 * The format is described a second time, in
 * `platform/app/src/utils/encryption.ts`, and that is worth being exact about.
 * That module is a leaf forty others depend on, and the repository's
 * package-boundaries rule allows a feature server package to be imported only
 * by a composition root — so it cannot call this class, and collapsing the two
 * means moving those callers first. Until then neither description is free to
 * drift: both suites decrypt the SAME recorded row, so a change to one of them
 * turns the other red.
 *
 * What does NOT live here is where the key comes from. Each process reads its
 * own environment and hands the key in, which is why this class names no
 * variable: the platform app reads `CREDENTIALS_SECRET` (falling back to
 * `NEXTAUTH_SECRET`) and so does the API executable's validated
 * configuration, and neither fact belongs to the cipher.
 */
export class AesGcmSecretEncryptionAdapter extends SecretEncryptionPort {
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
    super();
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
   * Reads a value back, or refuses.
   *
   * The two refusals say different things and are deliberately kept apart: a
   * string that is not three hex parts was never written by this cipher, while
   * a well-formed string that fails its authentication tag was — under a
   * different key, or after the ciphertext was altered. Neither message
   * repeats what the caller passed in, because the caller passed in a
   * customer's credential.
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
