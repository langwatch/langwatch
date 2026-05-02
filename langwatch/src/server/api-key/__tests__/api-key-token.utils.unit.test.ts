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
  describe("when verifying with current HMAC hash", () => {
    it("returns match", () => {
      const secret = "testSecretValue123";
      const hashed = hashSecret(secret);
      expect(verifySecret(secret, hashed)).toBe("match");
    });
  });

  describe("when verifying with legacy plain SHA-256 hash", () => {
    it("returns match_legacy", () => {
      const secret = "legacySecretValue123";
      // Simulate a hash created with the old plain SHA-256 algorithm
      const legacyHash = require("node:crypto")
        .createHash("sha256")
        .update(secret)
        .digest("hex");
      expect(verifySecret(secret, legacyHash)).toBe("match_legacy");
    });
  });

  describe("when secret does not match", () => {
    it("returns no_match", () => {
      const hashed = hashSecret("correct");
      expect(verifySecret("wrong", hashed)).toBe("no_match");
    });
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
