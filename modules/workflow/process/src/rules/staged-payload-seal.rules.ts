import { createCipheriv, randomBytes } from "node:crypto";

export type SealedStagedPayload = Readonly<{
  /** nonce (12) then ciphertext then GCM tag (16): what Go's `cipher.AEAD.Open` takes. */
  sealed: Buffer;
  /** The run's key, base64. It travels in the invoke envelope and is stored nowhere. */
  key: string;
}>;

/** Seals a parked run body under a fresh AES-256-GCM key, so the stored object is unreadable. */
export function sealStagedPayload(plain: Buffer): SealedStagedPayload {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const sealed = Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  return { sealed, key: key.toString("base64") };
}
