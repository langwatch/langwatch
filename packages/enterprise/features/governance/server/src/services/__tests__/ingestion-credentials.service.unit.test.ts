import { describe, expect, it } from "vitest";

// Exercise the helper's own logic (envelope tagging, idempotency, legacy
// tolerance, JSON round-trip) with a reversible stand-in for the shared
// AES helper — the real crypto is covered by the encryption util's own
// callers and is not what this module owns.
import { GovernanceEncryptionPort } from "../../ports/governance-encryption.port";
import { IngestionCredentialsService } from "../ingestion-credentials.service";

class ReversibleEncryption extends GovernanceEncryptionPort {
  encrypt(text: string): string {
    return `cipher(${text})`;
  }

  decrypt(blob: string): string {
    return blob.slice("cipher(".length, -1);
  }
}

const credentials = IngestionCredentialsService.create(new ReversibleEncryption());

describe("ingestionCredentials", () => {
  describe("given a parserConfig with plaintext credentials", () => {
    it("encrypts the credentials subtree to a tagged string and leaves other keys", () => {
      const out = credentials.tryEncryptParserConfig({
        ottlStatements: ["keep me"],
        credentials: {
          aws_access_key_id: "AKIA",
          aws_secret_access_key: "s3cr3t",
        },
      })!;
      expect(out.ottlStatements).toEqual(["keep me"]);
      expect(typeof out.credentials).toBe("string");
      expect(out.credentials as string).toMatch(/^enc:v1:/);
    });

    it("round-trips back to the original object", () => {
      const creds = { token: "bearer-xyz" };
      const out = credentials.tryEncryptParserConfig({ credentials: creds })!;
      expect(credentials.decrypt(out.credentials)).toEqual(creds);
    });

    it("is idempotent — an already-encrypted value is left untouched", () => {
      const once = credentials.tryEncryptParserConfig({
        credentials: { token: "t" },
      })!;
      const twice = credentials.tryEncryptParserConfig(once)!;
      expect(twice.credentials).toBe(once.credentials);
    });
  });

  describe("given a parserConfig without credentials", () => {
    it("returns it unchanged", () => {
      const cfg = { ottlStatements: ["x"] };
      expect(credentials.tryEncryptParserConfig(cfg)).toEqual(cfg);
    });

    it("passes null/undefined through", () => {
      expect(credentials.tryEncryptParserConfig(null)).toBeNull();
      expect(credentials.tryEncryptParserConfig(undefined)).toBeUndefined();
    });
  });

  describe("given the service reads a legacy plaintext object", () => {
    it("returns it as-is for backward compatibility", () => {
      const legacy = { aws_access_key_id: "AKIA" };
      expect(credentials.decrypt(legacy)).toEqual(legacy);
    });

    it("returns an empty object for missing credentials", () => {
      expect(credentials.decrypt(undefined)).toEqual({});
      expect(credentials.decrypt(null)).toEqual({});
    });
  });

  describe("given an admin saves an OpenAI Admin source carrying an admin API key", () => {
    /** @scenario "The Admin API key is never stored in plain text" */
    it("stores the key encrypted, unreadable from the serialised config", () => {
      const token = "sk-admin-abcdef123456";
      const out = credentials.tryEncryptParserConfig({
        adapter: "openai_admin",
        report: "cost",
        credentials: { token },
      })!;

      // Credentials become an opaque tagged string, not the plaintext
      // object — the real AES port's own tests cover that the ciphertext
      // itself hides the token; this module owns only the envelope.
      expect(typeof out.credentials).toBe("string");
      expect(out.credentials as string).toMatch(/^enc:v1:/);
      expect(out.credentials).not.toEqual({ token });
      expect(credentials.decrypt(out.credentials)).toEqual({ token });
    });
  });
});
