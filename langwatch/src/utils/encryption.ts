import crypto from "crypto";
import { env } from "../env.mjs";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Uint8Array {
  const CREDENTIALS_SECRET = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!CREDENTIALS_SECRET) {
    throw new Error(
      "CREDENTIALS_SECRET is not set in the environment variables"
    );
  }

  const key = new Uint8Array(Buffer.from(CREDENTIALS_SECRET, "hex"));

  if (key.length !== 32) {
    throw new Error("CREDENTIALS_SECRET must be a 32-byte hex string");
  }

  return key;
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    new Uint8Array(iv)
  );

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted}:${authTag.toString("hex")}`; // Concatenate with a delimiter
}

export function decrypt(encryptedString: string): string {
  const [ivHex, encryptedData, authTagHex] = encryptedString.split(":"); // Split the string
  if (!ivHex || !encryptedData || !authTagHex) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      new Uint8Array(iv)
    );
    decipher.setAuthTag(new Uint8Array(authTag));

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    throw new Error(
      "Failed to decrypt: Data may be corrupted or tampered with"
    );
  }
}
