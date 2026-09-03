import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  getTokenType,
  INGEST_KEY_PREFIX,
  splitApiKeyToken,
} from "@langwatch/api-key-contract";
import { ApiKeyTokenAdapter } from "../api-key-token.api-key-token.adapter";

const PEPPER = "test-pepper";
const generateToken = (options?: { prefix?: string }) =>
  ApiKeyTokenAdapter.generateApiKeyToken(PEPPER, options);

describe("generateApiKeyToken", () => {
  /** @scenario "New API keys are minted with sk-lw- prefix" */
  it("produces a token with sk-lw- prefix", () => {
    const { token } = generateToken();
    expect(token.startsWith("sk-lw-")).toBe(true);
  });

  it("produces a token with lookupId_secret structure", () => {
    const { token, lookupId, hashedSecret } = generateToken();
    const body = token.slice(API_KEY_PREFIX.length);
    const parts = body.split("_");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(lookupId);
    expect(hashedSecret).toBeTruthy();
  });

  it("produces unique tokens on each call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.lookupId).not.toBe(b.lookupId);
  });

  describe("when an ingest prefix is passed", () => {
    it("mints an ik-lw- token (ingestion keys)", () => {
      const { token } = generateToken({ prefix: INGEST_KEY_PREFIX });
      expect(token.startsWith("ik-lw-")).toBe(true);
    });
  });
});

describe("splitApiKeyToken", () => {
  describe("when given a new sk-lw- token", () => {
    it("extracts lookupId and secret", () => {
      const { token, lookupId } = generateToken();
      const parts = splitApiKeyToken(token);
      expect(parts).not.toBeNull();
      expect(parts!.lookupId).toBe(lookupId);
      expect(parts!.secret).toBeTruthy();
    });
  });

  describe("when given an old pat-lw- token", () => {
    /** @scenario "Old pat-lw- tokens still authenticate" */
    it("extracts lookupId and secret (backward compat)", () => {
      const result = splitApiKeyToken(
        "pat-lw-abcdefghijklmnop_secretsecretsecretsecretsecretsecretsecretsecretsecretsecr",
      );
      expect(result).not.toBeNull();
      expect(result!.lookupId).toBe("abcdefghijklmnop");
    });
  });

  describe("when given an ingest ik-lw- token", () => {
    it("extracts lookupId and secret (resolves like any API key)", () => {
      const { token, lookupId } = generateToken({
        prefix: INGEST_KEY_PREFIX,
      });
      const parts = splitApiKeyToken(token);
      expect(parts).not.toBeNull();
      expect(parts!.lookupId).toBe(lookupId);
      expect(parts!.secret).toBeTruthy();
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
      const hashed = ApiKeyTokenAdapter.hashApiKeySecret(secret, PEPPER);
      expect(ApiKeyTokenAdapter.verifyApiKeySecret(secret, hashed, PEPPER)).toBe("match");
    });
  });

  describe("when verifying with legacy plain SHA-256 hash", () => {
    it("returns match_legacy", () => {
      const secret = "legacySecretValue123";
      // Simulate a hash created with the old plain SHA-256 algorithm
      const legacyHash = require("node:crypto").createHash("sha256").update(secret).digest("hex");
      expect(ApiKeyTokenAdapter.verifyApiKeySecret(secret, legacyHash, PEPPER)).toBe(
        "match_legacy",
      );
    });
  });

  describe("when secret does not match", () => {
    it("returns no_match", () => {
      const hashed = ApiKeyTokenAdapter.hashApiKeySecret("correct", PEPPER);
      expect(ApiKeyTokenAdapter.verifyApiKeySecret("wrong", hashed, PEPPER)).toBe("no_match");
    });
  });
});

describe("getTokenType", () => {
  describe("when given an old pat-lw- token", () => {
    /** @scenario "Token type detection distinguishes API keys from legacy project keys" */
    it("returns apiKey", () => {
      expect(getTokenType("pat-lw-abc_def")).toBe("apiKey");
    });
  });

  describe("when given a new-format sk-lw- token", () => {
    it("returns apiKey", () => {
      const { token } = generateToken();
      expect(getTokenType(token)).toBe("apiKey");
    });
  });

  describe("when given an ingest ik-lw- token", () => {
    it("returns apiKey", () => {
      const { token } = generateToken({ prefix: INGEST_KEY_PREFIX });
      expect(getTokenType(token)).toBe("apiKey");
    });
  });

  describe("when given a legacy project key (sk-lw- without underscore)", () => {
    it("returns legacyProjectKey", () => {
      expect(getTokenType("sk-lw-abc123def456")).toBe("legacyProjectKey");
    });
  });

  describe("when given a legacy project key whose body contains an underscore", () => {
    it("returns legacyProjectKey", () => {
      // Legacy keys are random strings from alphabets that include `_` and
      // `-` — an underscore must not flip them to the API key lookup path
      expect(getTokenType("sk-lw-AbCdEfGhIjKlMnOpQrStUvWxYz012345_floM")).toBe("legacyProjectKey");
    });
  });

  describe("when given an sk-lw- token with underscore but wrong segment lengths", () => {
    it("returns legacyProjectKey", () => {
      expect(getTokenType("sk-lw-abcdef1234567890_secretsecret")).toBe("legacyProjectKey");
    });
  });

  describe("when given an unknown prefix", () => {
    it("returns unknown", () => {
      expect(getTokenType("unknown-token")).toBe("unknown");
    });
  });
});
