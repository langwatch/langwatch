import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateLicenseKey } from "../licenseGenerationService";
import {
  isLicenseTokenShape,
  LICENSE_TOKEN_PREFIX,
  licenseTokenFromKey,
  registryHashForToken,
} from "../licenseToken";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function mintLicense(organizationName = "ACME"): string {
  return generateLicenseKey({
    organizationName,
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    privateKey,
    now: new Date("2026-09-19T00:00:00.000Z"),
  }).licenseKey;
}

/** Re-wraps a base64 string at 64 columns, the way mail clients and PEM tools do. */
function wrapAt64(value: string): string {
  return value.match(/.{1,64}/g)?.join("\n") ?? value;
}

describe("licenseTokenFromKey", () => {
  describe("given a license LangWatch signed", () => {
    const licenseKey = mintLicense();

    describe("when the token is derived", () => {
      it("returns the license prefix followed by 64 hex characters", () => {
        const token = licenseTokenFromKey(licenseKey);

        expect(token).toMatch(/^lwl_[0-9a-f]{64}$/);
        expect(token?.startsWith(LICENSE_TOKEN_PREFIX)).toBe(true);
      });

      it("returns the same token every time", () => {
        expect(licenseTokenFromKey(licenseKey)).toBe(
          licenseTokenFromKey(licenseKey),
        );
      });

      it("does not contain the license key", () => {
        const token = licenseTokenFromKey(licenseKey);

        expect(token).not.toContain(licenseKey.slice(0, 24));
      });
    });

    describe("when the same license is presented with different line wrapping and trailing whitespace", () => {
      /** @scenario The same license always maps to the same registry row */
      it("derives the same token", () => {
        const expected = licenseTokenFromKey(licenseKey);

        expect(licenseTokenFromKey(`${licenseKey}\n`)).toBe(expected);
        expect(licenseTokenFromKey(`  ${licenseKey}  `)).toBe(expected);
        expect(licenseTokenFromKey(wrapAt64(licenseKey))).toBe(expected);
        expect(licenseTokenFromKey(`${wrapAt64(licenseKey)}\r\n`)).toBe(
          expected,
        );
      });
    });
  });

  describe("given two different licenses", () => {
    describe("when their tokens are derived", () => {
      it("derives different tokens", () => {
        expect(licenseTokenFromKey(mintLicense("ACME"))).not.toBe(
          licenseTokenFromKey(mintLicense("ACME Europe")),
        );
      });
    });
  });

  describe("given text that is not a license", () => {
    describe("when the token is derived", () => {
      it("returns null for an empty string", () => {
        expect(licenseTokenFromKey("")).toBeNull();
      });

      it("returns null for text that does not parse as a license", () => {
        expect(licenseTokenFromKey("not-a-license")).toBeNull();
      });
    });
  });
});

describe("registryHashForToken", () => {
  describe("given a license token", () => {
    const token = licenseTokenFromKey(mintLicense()) as string;

    describe("when its registry hash is computed", () => {
      /** @scenario The registry stores a hash of the token, not the token */
      it("returns 64 hex characters that are not the token body", () => {
        const hash = registryHashForToken(token);

        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hash).not.toBe(token.slice(LICENSE_TOKEN_PREFIX.length));
        expect(token).not.toContain(hash);
      });

      it("returns the same hash every time, so a row can be looked up by it", () => {
        expect(registryHashForToken(token)).toBe(registryHashForToken(token));
      });

      it("is the SHA-256 of the whole token, prefix included", () => {
        const expected = createHash("sha256").update(token).digest("hex");

        expect(registryHashForToken(token)).toBe(expected);
      });
    });
  });
});

describe("isLicenseTokenShape", () => {
  describe("when the value is the license prefix and 64 lowercase hex characters", () => {
    it("accepts it", () => {
      expect(isLicenseTokenShape(`lwl_${"a1".repeat(32)}`)).toBe(true);
    });
  });

  describe("when the value deviates from that shape", () => {
    it("refuses a virtual key", () => {
      expect(isLicenseTokenShape("vk-lw-01HZX9N0000000000000000000")).toBe(
        false,
      );
    });

    it("refuses a body that is too short", () => {
      expect(isLicenseTokenShape(`lwl_${"a".repeat(63)}`)).toBe(false);
    });

    it("refuses a body that is too long", () => {
      expect(isLicenseTokenShape(`lwl_${"a".repeat(65)}`)).toBe(false);
    });

    it("refuses uppercase hex", () => {
      expect(isLicenseTokenShape(`lwl_${"A".repeat(64)}`)).toBe(false);
    });

    it("refuses characters outside hex", () => {
      expect(isLicenseTokenShape(`lwl_${"g".repeat(64)}`)).toBe(false);
    });
  });
});
