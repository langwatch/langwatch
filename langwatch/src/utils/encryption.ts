import crypto from "crypto";
import { env } from "../env.mjs";

const CREDENTIALS_SECRET = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;

if (!CREDENTIALS_SECRET) {
  throw new Error("CREDENTIALS_SECRET is not set in the environment variables");
}

const algorithm = "aes-256-gcm";

const key = new Uint8Array(Buffer.from(CREDENTIALS_SECRET, "hex"));

if (key.length !== 32) {
  throw new Error("CREDENTIALS_SECRET must be a 32-byte hex string");
}

export function encrypt(text: string): {
  iv: string;
  encryptedData: string;
  authTag: string;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, new Uint8Array(iv));

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    encryptedData: encrypted,
    authTag: authTag.toString("hex"),
  };
}

export function decrypt(
  encryptedData: string,
  iv: string,
  authTag: string
): string {
  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    new Uint8Array(Buffer.from(iv, "hex"))
  );
  decipher.setAuthTag(new Uint8Array(Buffer.from(authTag, "hex")));

  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
