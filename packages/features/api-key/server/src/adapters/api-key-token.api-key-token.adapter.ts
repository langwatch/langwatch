import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  API_KEY_PREFIX,
  INGEST_KEY_PREFIX,
  LEGACY_PAT_PREFIX,
  splitApiKeyToken,
} from "@langwatch/api-key-contract";
import { ApiKeyTokenPort } from "../ports/api-key-token.port";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export class ApiKeyTokenAdapter extends ApiKeyTokenPort {
  constructor(private readonly pepper: string) {
    super();
  }

  static create(pepper: string): ApiKeyTokenAdapter {
    return new ApiKeyTokenAdapter(pepper);
  }

  generate(options: { prefix?: string } = {}) {
    return ApiKeyTokenAdapter.generateApiKeyToken(this.pepper, options);
  }

  generateLegacyProjectKey(): string {
    return `${API_KEY_PREFIX}${ApiKeyTokenAdapter.randomText(48)}`;
  }

  verify(secret: string, hashedSecret: string) {
    return ApiKeyTokenAdapter.verifyApiKeySecret(secret, hashedSecret, this.pepper);
  }

  hash(secret: string): string {
    return ApiKeyTokenAdapter.hashApiKeySecret(secret, this.pepper);
  }

  trySplit(token: string) {
    return splitApiKeyToken(token);
  }

  static randomText(length: number): string {
    return Array.from(
      randomBytes(length),
      (byte) => ALPHABET[byte % ALPHABET.length],
    ).join("");
  }

  static hashApiKeySecret(secret: string, pepper: string): string {
    return createHmac("sha256", pepper).update(secret).digest("hex");
  }

  static verifyApiKeySecret(
    secret: string,
    hashedSecret: string,
    pepper: string,
  ): "match" | "match_legacy" | "no_match" {
    const stored = Buffer.from(hashedSecret, "hex");
    const current = Buffer.from(this.hashApiKeySecret(secret, pepper), "hex");
    if (stored.length === current.length && timingSafeEqual(stored, current))
      return "match";
    const legacy = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
    return stored.length === legacy.length && timingSafeEqual(stored, legacy)
      ? "match_legacy"
      : "no_match";
  }

  static generateApiKeyToken(
    pepper: string,
    options: { prefix?: string } = {},
  ): { token: string; lookupId: string; hashedSecret: string } {
    const lookupId = this.randomText(16);
    const secret = this.randomText(48);
    const prefix = options.prefix ?? API_KEY_PREFIX;
    return {
      token: `${prefix}${lookupId}_${secret}`,
      lookupId,
      hashedSecret: this.hashApiKeySecret(secret, pepper),
    };
  }
}

export { API_KEY_PREFIX, INGEST_KEY_PREFIX, LEGACY_PAT_PREFIX, splitApiKeyToken };
