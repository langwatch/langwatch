import { describe, expect, it, vi } from "vitest";

// Exercise the helper's own logic (envelope tagging, idempotency, legacy
// tolerance, JSON round-trip) with a reversible stand-in for the shared
// AES helper — the real crypto is covered by the encryption util's own
// callers and is not what this module owns.
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `cipher(${text})`,
  decrypt: (blob: string) => blob.slice("cipher(".length, -1),
}));

import {
  decryptCredentials,
  encryptParserConfigCredentials,
} from "../ingestionCredentials";

describe("ingestionCredentials", () => {
  describe("given a parserConfig with plaintext credentials", () => {
    it("encrypts the credentials subtree to a tagged string and leaves other keys", () => {
      const out = encryptParserConfigCredentials({
        ottlStatements: ["keep me"],
        credentials: { aws_access_key_id: "AKIA", aws_secret_access_key: "s3cr3t" },
      })!;
      expect(out.ottlStatements).toEqual(["keep me"]);
      expect(typeof out.credentials).toBe("string");
      expect(out.credentials as string).toMatch(/^enc:v1:/);
    });

    it("round-trips back to the original object via decryptCredentials", () => {
      const creds = { token: "bearer-xyz" };
      const out = encryptParserConfigCredentials({ credentials: creds })!;
      expect(decryptCredentials(out.credentials)).toEqual(creds);
    });

    it("is idempotent — an already-encrypted value is left untouched", () => {
      const once = encryptParserConfigCredentials({ credentials: { token: "t" } })!;
      const twice = encryptParserConfigCredentials(once)!;
      expect(twice.credentials).toBe(once.credentials);
    });
  });

  describe("given a parserConfig without credentials", () => {
    it("returns it unchanged", () => {
      const cfg = { ottlStatements: ["x"] };
      expect(encryptParserConfigCredentials(cfg)).toEqual(cfg);
    });

    it("passes null/undefined through", () => {
      expect(encryptParserConfigCredentials(null)).toBeNull();
      expect(encryptParserConfigCredentials(undefined)).toBeUndefined();
    });
  });

  describe("given decryptCredentials reads a legacy plaintext object", () => {
    it("returns it as-is for backward compatibility", () => {
      const legacy = { aws_access_key_id: "AKIA" };
      expect(decryptCredentials(legacy)).toEqual(legacy);
    });

    it("returns an empty object for missing credentials", () => {
      expect(decryptCredentials(undefined)).toEqual({});
      expect(decryptCredentials(null)).toEqual({});
    });
  });
});
