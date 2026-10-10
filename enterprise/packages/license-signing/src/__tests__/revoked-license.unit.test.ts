import { generateKeyPairSync } from "node:crypto";

import { LICENSE_ERRORS } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { LicenseGenerationService } from "../license-generation.ts";
import { NodeLicenseCryptographyService } from "../node-license-cryptography.ts";

const REVOKED_LICENSE_ID = "lic-d6f0f20c-f1f9-4489-bc0a-77b156986b0c";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const cryptography = NodeLicenseCryptographyService.create({ publicKey });

function licenseWithId(licenseId: string): string {
  const { licenseData } = LicenseGenerationService.create(cryptography).generate({
    organizationName: "Acme Corp",
    email: "admin@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 100,
    privateKey,
  });
  return cryptography.encodeLicenseKey(
    cryptography.signLicense({ ...licenseData, licenseId }, privateKey),
  );
}

describe("NodeLicenseCryptographyService", () => {
  describe("given a license on the revocation list, signed by the verifier's key", () => {
    describe("when it is verified", () => {
      /** @scenario "A revoked license never verifies, whatever key signed it" */
      it("is refused as an invalid signature", () => {
        const licenseKey = licenseWithId(REVOKED_LICENSE_ID);
        const signed = cryptography.parseLicenseKey(licenseKey);

        expect(signed).not.toBeNull();
        expect(signed && cryptography.verifySignature(signed)).toBe(false);
        expect(cryptography.validateLicense({ licenseKey })).toEqual({
          valid: false,
          error: LICENSE_ERRORS.INVALID_SIGNATURE,
        });
      });
    });
  });

  describe("given the same license under an id that is not revoked", () => {
    describe("when it is validated", () => {
      it("is valid", () => {
        expect(
          cryptography.validateLicense({ licenseKey: licenseWithId("lic-not-revoked") }),
        ).toMatchObject({
          valid: true,
        });
      });
    });
  });
});
