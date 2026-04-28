import { describe, expect, it } from "vitest";
import {
  generateApiKeyToken,
  splitApiKeyToken,
  hashSecret,
  verifySecret,
  getTokenType,
  API_KEY_PREFIX,
} from "../api-key-token.utils";

describe("generateApiKeyToken", () => {
  it("produces a token with sk-lw- prefix", () => {
    const { token } = generateApiKeyToken();
    expect(token.startsWith("sk-lw-")).toBe(true);
  });

  it("produces a token with lookupId_secret structure", () => {
    const { token, lookupId, hashedSecret } = generateApiKeyToken();
    const body = token.slice(API_KEY_PREFIX.length);
    const parts = body.split("_");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(lookupId);
    expect(hashedSecret).toBeTruthy();
  });

  it("produces unique tokens on each call", () => {
    const a = generateApiKeyToken();
    const b = generateApiKeyToken();
    expect(a.token).not.toBe(b.token);
    expect(a.lookupId).not.toBe(b.lookupId);
  });
});

describe("splitApiKeyToken", () => {
  describe("when given a new sk-lw- token", () => {
    it("extracts lookupId and secret", () => {
      const { token, lookupId } = generateApiKeyToken();
      const parts = splitApiKeyToken(token);
      expect(parts).not.toBeNull();
      expect(parts!.lookupId).toBe(lookupId);
      expect(parts!.secret).toBeTruthy();
    });
  });

  describe("when given an old pat-lw- token", () => {
    it("extracts lookupId and secret (backward compat)", () => {
      const result = splitApiKeyToken("pat-lw-abcdefghijklmnop_secretsecretsecretsecretsecretsecretsecretsecretsecretsecr");
      expect(result).not.toBeNull();
      expect(result!.lookupId).toBe("abcdefghijklmnop");
    });
  });

  describe("when given a legacy project key (no underscore)", () => {
    it("returns null", () => {
      expect(splitApiKeyToken("sk-lw-abc123def456")).toBeNull();
    });
  });

  describe("when given an unknown prefix", () => {
    it("returns null", () => {
      expect(splitApiKeyToken("unknown-prefix-token")).toBeNull();
    });
  });

  describe("when given an empty string", () => {
    it("returns null", () => {
      expect(splitApiKeyToken("")).toBeNull();
    });
  });
});

describe("verifySecret", () => {
  it("returns true for matching secret", () => {
    const secret = "testSecretValue123";
    const hashed = hashSecret(secret);
    expect(verifySecret(secret, hashed)).toBe(true);
  });

  it("returns false for non-matching secret", () => {
    const hashed = hashSecret("correct");
    expect(verifySecret("wrong", hashed)).toBe(false);
  });
});

describe("getTokenType", () => {
  describe("when given an old pat-lw- token", () => {
    it("returns apiKey", () => {
      expect(getTokenType("pat-lw-abc_def")).toBe("apiKey");
    });
  });

  describe("when given a new sk-lw- token with underscore", () => {
    it("returns apiKey", () => {
      expect(getTokenType("sk-lw-abcdef1234567890_secretsecret")).toBe("apiKey");
    });
  });

  describe("when given a legacy project key (sk-lw- without underscore)", () => {
    it("returns legacyProjectKey", () => {
      expect(getTokenType("sk-lw-abc123def456")).toBe("legacyProjectKey");
    });
  });

  describe("when given an unknown prefix", () => {
    it("returns unknown", () => {
      expect(getTokenType("unknown-token")).toBe("unknown");
    });
  });
});
