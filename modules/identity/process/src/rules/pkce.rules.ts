import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** RFC 7636 S256: base64url(SHA-256(code_verifier)). */
export function s256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** A fresh single-use token for a magic link — rides only in the link. */
export function mintVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time string comparison. Unequal lengths answer false without a compare. */
export function safeEqual(a: string, b: string): boolean {
  const bytesA = Buffer.from(a, "utf8");
  const bytesB = Buffer.from(b, "utf8");

  return bytesA.length === bytesB.length && timingSafeEqual(bytesA, bytesB);
}
