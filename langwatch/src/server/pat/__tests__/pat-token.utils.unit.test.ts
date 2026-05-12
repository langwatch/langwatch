import { describe, it, expect } from "vitest";
import {
  generatePatToken,
  splitPatToken,
  hashSecret,
  verifySecret,
  getTokenType,
  PAT_PREFIX,
} from "../pat-token.utils";

describe("PAT Token Utilities", () => {
  describe("generatePatToken", () => {
    it("generates a token with the correct prefix", () => {
      const { token } = generatePatToken();
      expect(token.startsWith(PAT_PREFIX)).toBe(true);
    });

    it("generates a token in the format pat-lw-{lookupId}_{secret}", () => {
      const { token, lookupId, hashedSecret } = generatePatToken();
      expect(token).toBe(`${PAT_PREFIX}${lookupId}_${token.split("_")[1]}`);
      expect(lookupId).toHaveLength(16);
      expect(hashedSecret).toHaveLength(64); // SHA-256 hex
    });

    it("generates unique tokens on each call", () => {
      const a = generatePatToken();
      const b = generatePatToken();
      expect(a.token).not.toBe(b.token);
      expect(a.lookupId).not.toBe(b.lookupId);
      expect(a.hashedSecret).not.toBe(b.hashedSecret);
    });

    it("returns a hashedSecret that matches the secret portion", () => {
      const { token, hashedSecret } = generatePatToken();
      const parts = splitPatToken(token);
      expect(parts).not.toBeNull();
      expect(verifySecret(parts!.secret, hashedSecret)).toBe(true);
    });
  });

  describe("splitPatToken", () => {
    it("parses a valid PAT token", () => {
      const { token, lookupId } = generatePatToken();
      const parts = splitPatToken(token);
      expect(parts).not.toBeNull();
      expect(parts!.lookupId).toBe(lookupId);
      expect(parts!.secret).toBeTruthy();
    });

    it("returns null for tokens without the PAT prefix", () => {
      expect(splitPatToken("sk-lw-abc123")).toBeNull();
      expect(splitPatToken("random-token")).toBeNull();
    });

    it("returns null for tokens without an underscore separator", () => {
      expect(splitPatToken("pat-lw-noseparator")).toBeNull();
    });

    it("returns null for tokens with empty parts", () => {
      expect(splitPatToken("pat-lw-_secret")).toBeNull();
      expect(splitPatToken("pat-lw-lookupId_")).toBeNull();
    });
  });

  describe("hashSecret", () => {
    it("produces a consistent SHA-256 hex digest", () => {
      const secret = "testSecret123";
      const hash1 = hashSecret(secret);
      const hash2 = hashSecret(secret);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("produces different hashes for different inputs", () => {
      expect(hashSecret("secretA")).not.toBe(hashSecret("secretB"));
    });
  });

  describe("verifySecret", () => {
    it("returns true for matching secret and hash", () => {
      const secret = "myTestSecret";
      const hashed = hashSecret(secret);
      expect(verifySecret(secret, hashed)).toBe(true);
    });

    it("returns false for non-matching secret", () => {
      const hashed = hashSecret("correctSecret");
      expect(verifySecret("wrongSecret", hashed)).toBe(false);
    });
  });

  describe("getTokenType", () => {
    it("identifies PAT tokens", () => {
      expect(getTokenType("pat-lw-abc_def")).toBe("pat");
    });

    it("identifies legacy tokens", () => {
      expect(getTokenType("sk-lw-abc123")).toBe("legacy");
    });

    it("returns unknown for unrecognized tokens", () => {
      expect(getTokenType("random-token")).toBe("unknown");
      expect(getTokenType("")).toBe("unknown");
    });
  });
});
