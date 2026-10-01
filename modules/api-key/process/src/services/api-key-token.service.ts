import { randomBytes } from "node:crypto";

import { API_KEY_PREFIX, parseApiKeyToken } from "@langwatch/api-key-contract";

import {
  hashApiKeySecret,
  verifyApiKeySecret,
  type ApiKeySecretVerdict,
} from "../rules/api-key-token.rules.ts";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export class ApiKeyTokenService {
  private constructor(private readonly pepper: string) {}

  static create(pepper: string): ApiKeyTokenService {
    return new ApiKeyTokenService(pepper);
  }

  generate(options: { prefix?: string } = {}): {
    token: string;
    lookupId: string;
    hashedSecret: string;
  } {
    const lookupId = this.randomText(16);
    const secret = this.randomText(48);
    const prefix = options.prefix ?? API_KEY_PREFIX;
    return {
      token: `${prefix}${lookupId}_${secret}`,
      lookupId,
      hashedSecret: this.hash(secret),
    };
  }

  generateLegacyProjectKey(): string {
    return `${API_KEY_PREFIX}${this.randomText(48)}`;
  }

  verify(secret: string, hashedSecret: string): ApiKeySecretVerdict {
    return verifyApiKeySecret({ secret, hashedSecret, pepper: this.pepper });
  }

  hash(secret: string): string {
    return hashApiKeySecret({ secret, pepper: this.pepper });
  }

  findTokenParts(token: string): { lookupId: string; secret: string } | null {
    return parseApiKeyToken(token);
  }

  private randomText(length: number): string {
    return Array.from(randomBytes(length), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  }
}
