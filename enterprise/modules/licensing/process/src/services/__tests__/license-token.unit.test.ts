import { createHash } from "node:crypto";

/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/license-registry.feature
 */
import {
  isLicenseTokenShape,
  LICENSE_TOKEN_PREFIX,
  registryHashForToken,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import { TEST_PRIVATE_KEY } from "../../fixtures/license-keys.fixture.ts";
import { LicenseGenerationService } from "../license-generation.service.ts";
import { NodeLicenseCryptographyAdapter } from "../node-license-cryptography.service.ts";

const cryptography = NodeLicenseCryptographyAdapter.create();
const generation = LicenseGenerationService.create(cryptography);

function mintLicense(organizationName = "ACME"): string {
  return generation.generate({
    organizationName,
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    privateKey: TEST_PRIVATE_KEY,
    now: new Date("2026-09-19T00:00:00.000Z"),
  }).licenseKey;
}

/** Re-wraps a base64 string at 64 columns, the way mail clients and PEM tools do. */
function wrapAt64(value: string): string {
  return value.match(/.{1,64}/g)?.join("\n") ?? value;
}

describe("the license token", () => {
  describe("given a license LangWatch signed", () => {
    const licenseKey = mintLicense();

    describe("when the token is derived", () => {
      it("is the license prefix followed by 64 hex characters", () => {
        const token = cryptography.getLicenseToken(licenseKey);

        expect(token).toMatch(/^lwl_[0-9a-f]{64}$/);
        expect(token.startsWith(LICENSE_TOKEN_PREFIX)).toBe(true);
      });

      it("is the same token every time", () => {
        expect(cryptography.getLicenseToken(licenseKey)).toBe(
          cryptography.getLicenseToken(licenseKey),
        );
      });

      it("does not contain the license key", () => {
        expect(cryptography.getLicenseToken(licenseKey)).not.toContain(licenseKey.slice(0, 24));
      });
    });

    describe("when the same license is presented with different line wrapping and trailing whitespace", () => {
      /** @scenario "The same license always maps to the same registry row" */
      it("derives the same token", () => {
        const expected = cryptography.getLicenseToken(licenseKey);

        expect(cryptography.getLicenseToken(`${licenseKey}\n`)).toBe(expected);
        expect(cryptography.getLicenseToken(`  ${licenseKey}  `)).toBe(expected);
        expect(cryptography.getLicenseToken(wrapAt64(licenseKey))).toBe(expected);
        expect(cryptography.getLicenseToken(`${wrapAt64(licenseKey)}\r\n`)).toBe(expected);
      });
    });
  });

  describe("given two different licenses", () => {
    it("derives different tokens", () => {
      expect(cryptography.getLicenseToken(mintLicense("ACME"))).not.toBe(
        cryptography.getLicenseToken(mintLicense("ACME Europe")),
      );
    });
  });

  describe("given text that is not a license", () => {
    it("refuses an empty string by its code", () => {
      expect(() => cryptography.getLicenseToken("")).toThrow(
        expect.objectContaining({ code: "license_key_invalid" }),
      );
    });

    it("refuses text that does not parse as a license by its code", () => {
      expect(() => cryptography.getLicenseToken("not-a-license")).toThrow(
        expect.objectContaining({ code: "license_key_invalid" }),
      );
    });
  });
});

describe("the registry hash of a token", () => {
  const token = cryptography.getLicenseToken(mintLicense());

  it("is 64 hex characters that are not the token body", async () => {
    const hash = await registryHashForToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token.slice(LICENSE_TOKEN_PREFIX.length));
    expect(token).not.toContain(hash);
  });

  it("is the same hash every time, so a row can be looked up by it", async () => {
    expect(await registryHashForToken(token)).toBe(await registryHashForToken(token));
  });

  it("is the SHA-256 of the whole token, prefix included", async () => {
    expect(await registryHashForToken(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
  });
});

describe("the shape of a presented license token", () => {
  it("accepts the license prefix and 64 lowercase hex characters", () => {
    expect(isLicenseTokenShape(`lwl_${"a1".repeat(32)}`)).toBe(true);
  });

  it.each([
    ["a virtual key", "vk-lw-01HZX9N0000000000000000000"],
    ["a body that is too short", `lwl_${"a".repeat(63)}`],
    ["a body that is too long", `lwl_${"a".repeat(65)}`],
    ["uppercase hex", `lwl_${"A".repeat(64)}`],
    ["characters outside hex", `lwl_${"g".repeat(64)}`],
  ])("refuses %s", (_label, value) => {
    expect(isLicenseTokenShape(value)).toBe(false);
  });
});
