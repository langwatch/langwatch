import crypto from "crypto";

import {
  LicenseSigningFailedError,
  LicenseSigningKeyEncryptedError,
  LicenseSigningKeyNotPemError,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseData } from "@langwatch/enterprise-licensing-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { NodeLicenseCryptographyAdapter } from "../index.ts";
import {
  canonicalPemKey,
  mangledPemPastes,
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../testing.ts";

const cryptography = NodeLicenseCryptographyAdapter.create();
const encodeLicenseKey = cryptography.encodeLicenseKey.bind(cryptography);
const generateLicenseId = cryptography.generateLicenseId.bind(cryptography);
const parseLicenseKey = cryptography.parseLicenseKey.bind(cryptography);
const signLicense = cryptography.signLicense.bind(cryptography);
const verifySignature = cryptography.verifySignature.bind(cryptography);

const createTestLicenseData = (overrides: Partial<LicenseData> = {}): LicenseData => ({
  licenseId: "test-lic-001",
  version: 1,
  organizationName: "Test Org",
  email: "test@test.com",
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2030-12-31T23:59:59Z",
  plan: {
    type: "PRO",
    name: "Pro",
    maxMembers: 10,
    maxProjects: 20,
    maxMessagesPerMonth: 100000,
    evaluationsCredit: 500,
    maxWorkflows: 50,
    maxPrompts: 50,
    maxEvaluators: 50,
    maxScenarios: 50,
    canPublish: true,
  },
  ...overrides,
});

describe("signLicense", () => {
  it("creates RSA-SHA256 signature from license data", () => {
    const licenseData = createTestLicenseData();

    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);

    expect(signedLicense.data).toEqual(licenseData);
    expect(signedLicense.signature).toBeDefined();
    expect(typeof signedLicense.signature).toBe("string");
    expect(signedLicense.signature.length).toBeGreaterThan(0);
  });

  it("produces valid signature that can be verified with public key", () => {
    const licenseData = createTestLicenseData();

    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);
    const isValid = verifySignature(signedLicense, TEST_PUBLIC_KEY);

    expect(isValid).toBe(true);
  });

  it("produces different signatures for different license data", () => {
    const licenseData1 = createTestLicenseData({ organizationName: "Org A" });
    const licenseData2 = createTestLicenseData({ organizationName: "Org B" });

    const signed1 = signLicense(licenseData1, TEST_PRIVATE_KEY);
    const signed2 = signLicense(licenseData2, TEST_PRIVATE_KEY);

    expect(signed1.signature).not.toBe(signed2.signature);
  });

  it("produces consistent signatures for same license data", () => {
    const licenseData = createTestLicenseData();

    const signed1 = signLicense(licenseData, TEST_PRIVATE_KEY);
    const signed2 = signLicense(licenseData, TEST_PRIVATE_KEY);

    expect(signed1.signature).toBe(signed2.signature);
  });

  it("throws error for invalid private key", () => {
    const licenseData = createTestLicenseData();
    const invalidKey = "not-a-valid-key";

    expect(() => signLicense(licenseData, invalidKey)).toThrow(LicenseSigningKeyNotPemError);
  });
});

describe("signLicense, given a key the operator pasted", () => {
  describe("when the pasted private key carries stray whitespace", () => {
    const canonicalKey = canonicalPemKey(TEST_PRIVATE_KEY);

    for (const [description, pastedKey] of Object.entries(mangledPemPastes(canonicalKey))) {
      it(`signs a license with a key that has ${description}`, () => {
        const signedLicense = signLicense(createTestLicenseData(), pastedKey);

        expect(verifySignature(signedLicense, TEST_PUBLIC_KEY)).toBe(true);
      });

      it(`produces the same signature as the pristine key for a key that has ${description}`, () => {
        const licenseData = createTestLicenseData();

        expect(signLicense(licenseData, pastedKey).signature).toBe(
          signLicense(licenseData, canonicalKey).signature,
        );
      });
    }
  });

  describe("when the key arrives as a multi-block PEM bundle", () => {
    const bundle = (first: string, second: string) => `${first}${second}`;

    it("signs when the public block comes before the private key", () => {
      const signedLicense = signLicense(
        createTestLicenseData(),
        bundle(TEST_PUBLIC_KEY, TEST_PRIVATE_KEY),
      );

      expect(verifySignature(signedLicense, TEST_PUBLIC_KEY)).toBe(true);
    });

    it("signs when the private key comes first", () => {
      const signedLicense = signLicense(
        createTestLicenseData(),
        bundle(TEST_PRIVATE_KEY, TEST_PUBLIC_KEY),
      );

      expect(verifySignature(signedLicense, TEST_PUBLIC_KEY)).toBe(true);
    });

    it("signs a bundle that is also indented", () => {
      const indented = bundle(TEST_PUBLIC_KEY, TEST_PRIVATE_KEY)
        .split("\n")
        .map((line) => `   ${line}`)
        .join("\n");

      const signedLicense = signLicense(createTestLicenseData(), indented);

      expect(verifySignature(signedLicense, TEST_PUBLIC_KEY)).toBe(true);
    });
  });
});

/** A passphrase-protected key, which signing can never use as-is. */
const encryptedKey = () =>
  crypto
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

describe("signLicense, given a key it cannot sign with", () => {
  describe("when the key is not a usable signing key", () => {
    it("raises a handled error the transport layers map to a 400", () => {
      expect(() => signLicense(createTestLicenseData(), "not-a-valid-key")).toThrow(
        expect.objectContaining({ isHandled: true, httpStatus: 400, fault: "customer" }),
      );
    });

    it("distinguishes input that is not a PEM key", () => {
      expect(() => signLicense(createTestLicenseData(), "not-a-valid-key")).toThrow(
        LicenseSigningKeyNotPemError,
      );
    });

    it("distinguishes a passphrase-protected key", () => {
      expect(() => signLicense(createTestLicenseData(), encryptedKey())).toThrow(
        LicenseSigningKeyEncryptedError,
      );
    });

    it("distinguishes a well-formed key OpenSSL refuses to sign with", () => {
      expect(() => signLicense(createTestLicenseData(), TEST_PUBLIC_KEY)).toThrow(
        LicenseSigningFailedError,
      );
    });

    it("rejects a key whose body was corrupted, rather than repairing it", () => {
      const corrupted = TEST_PRIVATE_KEY.replace(/^([A-Za-z0-9+/]{10})/m, "AAAAAAAAAA");

      expect(() => signLicense(createTestLicenseData(), corrupted)).toThrow(
        LicenseSigningFailedError,
      );
    });
  });
});

/** What `sign` threw; throws itself when `sign` returned instead. */
function thrownBy(sign: () => unknown): unknown {
  try {
    sign();
  } catch (error) {
    return error;
  }
  throw new Error("expected signing to throw");
}

describe("signLicense, given a key it cannot sign with, what the failure carries", () => {
  describe("when signing fails", () => {
    it("carries remediation tips for the operator", () => {
      expect(() => signLicense(createTestLicenseData(), encryptedKey())).toThrow(
        expect.objectContaining({ tips: expect.arrayContaining([expect.anything()]) }),
      );
    });

    it("does not leak key material on the wire", () => {
      const publicKeyBody = TEST_PUBLIC_KEY.split("\n")[1]!;

      const failure = thrownBy(() => signLicense(createTestLicenseData(), TEST_PUBLIC_KEY));
      expect(failure).toBeInstanceOf(LicenseSigningFailedError);
      if (!(failure instanceof LicenseSigningFailedError)) {
        throw new Error("unreachable: asserted above");
      }

      expect(failure.message).not.toContain(publicKeyBody);
      expect(JSON.stringify(failure.serialize())).not.toContain(publicKeyBody);
    });
  });
});

describe("encodeLicenseKey", () => {
  let licenseData: LicenseData;
  let signedLicense: ReturnType<typeof signLicense>;
  let encodedKey: ReturnType<typeof encodeLicenseKey>;

  beforeEach(() => {
    licenseData = createTestLicenseData();
    signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);
    encodedKey = encodeLicenseKey(signedLicense);
  });

  it("produces valid base64 string", () => {
    expect(typeof encodedKey).toBe("string");
    // Valid base64 should only contain alphanumeric, +, /, and =
    expect(encodedKey).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("produces decodable JSON with data and signature fields", () => {
    const decoded = Buffer.from(encodedKey, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("signature");
    expect(parsed.data).toEqual(licenseData);
    expect(parsed.signature).toBe(signedLicense.signature);
  });

  it("produces key that can be parsed by parseLicenseKey", () => {
    const parsedLicense = parseLicenseKey(encodedKey);

    expect(parsedLicense).not.toBeNull();
    expect(parsedLicense?.data).toEqual(licenseData);
    expect(parsedLicense?.signature).toBe(signedLicense.signature);
  });

  it("produces key that validates successfully", () => {
    const parsedLicense = parseLicenseKey(encodedKey);

    expect(parsedLicense).not.toBeNull();
    if (!parsedLicense) throw new Error("unreachable: asserted above");
    const isValid = verifySignature(parsedLicense, TEST_PUBLIC_KEY);
    expect(isValid).toBe(true);
  });
});

describe("generateLicenseId", () => {
  it("produces unique IDs", () => {
    const id1 = generateLicenseId();
    const id2 = generateLicenseId();

    expect(id1).not.toBe(id2);
  });

  it("produces IDs starting with lic- prefix", () => {
    const id = generateLicenseId();

    expect(id).toMatch(/^lic-/);
  });

  it("produces IDs of consistent format", () => {
    const id = generateLicenseId();

    // Format: lic-{uuid} or similar unique identifier
    expect(id.length).toBeGreaterThan(4); // "lic-" + at least 1 character
  });

  it("produces 100 unique IDs without collision", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateLicenseId());
    }

    expect(ids.size).toBe(100);
  });
});
