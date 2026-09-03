import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { NodeLicenseCryptographyAdapter } from "../index";
import { canonicalPemKey, mangledPemPastes } from "../testing";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "../testing";

const { isEncryptedPemKey, looksLikePemKey, normalizePemKey } = NodeLicenseCryptographyAdapter;

/** A pristine key, exactly as `openssl` writes it. */
const canonicalKey = canonicalPemKey(TEST_PRIVATE_KEY);

/**
 * The ways a key arrives after a real copy/paste. Each must still sign, so the
 * assertion is a round-trip through OpenSSL, not a string comparison.
 */
const mangledPastes = mangledPemPastes(canonicalKey);

function signAndVerify(privateKey: string): boolean {
  const sign = crypto.createSign("SHA256");
  sign.update("payload");
  sign.end();
  const signature = sign.sign(privateKey, "base64");

  const verify = crypto.createVerify("SHA256");
  verify.update("payload");
  verify.end();
  return verify.verify(TEST_PUBLIC_KEY, signature, "base64");
}

describe("normalizePemKey", () => {
  describe("given a pristine key", () => {
    it("returns it unchanged", () => {
      expect(normalizePemKey(canonicalKey)).toBe(canonicalKey);
    });

    it("is idempotent", () => {
      const once = normalizePemKey(canonicalKey);

      expect(normalizePemKey(once)).toBe(once);
    });
  });

  describe("given a key mangled by copy/paste", () => {
    for (const [description, mangled] of Object.entries(mangledPastes)) {
      it(`recovers a signing key from a key with ${description}`, () => {
        expect(signAndVerify(normalizePemKey(mangled))).toBe(true);
      });

      it(`normalizes a key with ${description} to the canonical form`, () => {
        expect(normalizePemKey(mangled)).toBe(canonicalKey);
      });
    }
  });
});

describe("normalizePemKey, given input that is not one plain key", () => {
  describe("given a multi-block PEM bundle", () => {
    it("selects the private key rather than whichever block came first", () => {
      const normalized = normalizePemKey(`${TEST_PUBLIC_KEY}${canonicalKey}`);

      expect(normalized).toBe(canonicalKey);
    });

    it("keeps a bundle signable, as it was before normalization", () => {
      expect(signAndVerify(normalizePemKey(`${TEST_PUBLIC_KEY}${canonicalKey}`))).toBe(true);
    });

    it("selects the private key when it comes first too", () => {
      expect(normalizePemKey(`${canonicalKey}${TEST_PUBLIC_KEY}`)).toBe(canonicalKey);
    });
  });

  describe("given input that is not a PEM block", () => {
    it("returns the trimmed input so the caller sees the real error", () => {
      expect(normalizePemKey("  not-a-key  ")).toBe("not-a-key");
    });

    it("does not invent a block from a truncated key", () => {
      const truncated = "-----BEGIN RSA PRIVATE KEY-----\nMIIEog\n";

      expect(looksLikePemKey(truncated)).toBe(false);
    });
  });
});

describe("normalizePemKey, given an encrypted key", () => {
  describe("given a key carrying RFC 1421 headers", () => {
    const encryptedKey = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "Proc-Type: 4,ENCRYPTED",
      "DEK-Info: AES-256-CBC,0123456789ABCDEF",
      "",
      "MIIEogIBAAKCAQEApmJ61eRR1wxrapjipSmNIqYMJPmbonA1d6XV51kdnVs=",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    it("keeps the header block intact instead of folding it into the body", () => {
      const normalized = normalizePemKey(`   ${encryptedKey}`);

      expect(normalized).toContain("Proc-Type: 4,ENCRYPTED\nDEK-Info:");
      expect(normalized.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    });

    it("keeps the header block intact when every line is indented", () => {
      const indented = encryptedKey
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");

      const normalized = normalizePemKey(indented);

      expect(normalized).toContain("Proc-Type: 4,ENCRYPTED\nDEK-Info:");
      expect(isEncryptedPemKey(indented)).toBe(true);
    });

    it("reports the key as encrypted", () => {
      expect(isEncryptedPemKey(encryptedKey)).toBe(true);
    });
  });

  describe("given a PKCS#8 encrypted key", () => {
    it("reports the key as encrypted", () => {
      const encrypted = crypto
        .generateKeyPairSync("rsa", {
          modulusLength: 2048,
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: "aes-256-cbc",
            passphrase: "hunter2",
          },
          publicKeyEncoding: { type: "spki", format: "pem" },
        })
        .privateKey.toString();

      expect(isEncryptedPemKey(encrypted)).toBe(true);
    });
  });

  describe("given an unencrypted key", () => {
    it("does not report it as encrypted", () => {
      expect(isEncryptedPemKey(canonicalKey)).toBe(false);
    });
  });
});
