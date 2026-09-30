import { generateKeyPairSync } from "node:crypto";

import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import { describe, expect, it } from "vitest";

import { chooseSeedLicense, TEST_SUITE_ENTERPRISE_LICENSE_KEY } from "../seed-license.ts";

/** The public half of the licensing test suite's key pair, which signs the test-suite fixture. */
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApmJ61eRR1wxrapjipSmN
IqYMJPmbonA1d6XV51kdnVs/MdNrrdoWIal6TDt2lHvbAbrEalqR7h+vQzBBZ4St
ZPqBzTIHQwu3Wjlj7Fj7IeVUiJnRg60W+u9DmYXUeFBlZFMHxV3nNVqedwDcFpV/
IrAMmSe3QeTqBztcDMBxu5luA4DMU5Hi6kp4qcHDoCCiEH4a6ZZkPdNC+xpFdW41
75BwdKBKnyOZrUvyPaKrxInra7z+9YQKiggRciQvCNxc76Ef4DLGkTIf36Cvm7XL
m0gqlJm89dYcRBaDVGFTnb98BM7SrAIg117yjuuw5o/RmSlKq9/Klkz0QsXYF9Zj
iQIDAQAB
-----END PUBLIC KEY-----`;

const ORGANIZATION = {
  id: "local-dev-organization",
  name: "Local Dev Organization",
  email: "admin@example.test",
};

function keyPair(): { publicKey: string; privateKey: string } {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const dev = keyPair();
const stranger = keyPair();

describe("chooseSeedLicense", () => {
  describe("given the private key pairs with the boot public key", () => {
    describe("when the organization holds no valid licence", () => {
      /** @scenario "The seed signs an enterprise licence from the private key in secrets" */
      it("signs a fresh enterprise licence bound to the organization", () => {
        const choice = chooseSeedLicense({
          stored: "not-a-licence",
          publicKey: dev.publicKey,
          privateKey: dev.privateKey,
          organization: ORGANIZATION,
        });

        expect(choice.licenseKey).not.toBeNull();
        expect(choice).toMatchObject({ source: "signed" });
        const validation = NodeLicenseCryptographyService.create({
          publicKey: dev.publicKey,
        }).validateLicense({ licenseKey: choice.licenseKey ?? "" });
        expect(validation).toMatchObject({
          valid: true,
          licenseData: { organizationId: ORGANIZATION.id, plan: { type: "ENTERPRISE" } },
        });
      });
    });

    describe("when the organization already holds a valid licence", () => {
      /** @scenario "The seed keeps a stored licence that verifies" */
      it("keeps it rather than signing another", () => {
        const first = chooseSeedLicense({
          stored: null,
          publicKey: dev.publicKey,
          privateKey: dev.privateKey,
          organization: ORGANIZATION,
        });

        const second = chooseSeedLicense({
          stored: first.licenseKey,
          publicKey: dev.publicKey,
          privateKey: dev.privateKey,
          organization: ORGANIZATION,
        });

        expect(second).toEqual({ licenseKey: first.licenseKey, source: "stored" });
      });
    });
  });

  describe("given no private key", () => {
    describe("when no committed licence is valid under the boot public key", () => {
      /** @scenario "Without a private key the seed stores no licence and says why" */
      it("stores no licence and names the missing key", () => {
        expect(
          chooseSeedLicense({
            stored: null,
            publicKey: dev.publicKey,
            privateKey: undefined,
            organization: ORGANIZATION,
          }),
        ).toEqual({ licenseKey: null, reason: "no-private-key" });
      });
    });

    describe("when the stack boots with the test suite's public key, as CI does", () => {
      /** @scenario "CI keeps seeding the test-suite licence under the test key" */
      it("stores the test-suite enterprise licence", () => {
        expect(
          chooseSeedLicense({
            stored: null,
            publicKey: TEST_PUBLIC_KEY,
            privateKey: undefined,
            organization: ORGANIZATION,
          }),
        ).toEqual({ licenseKey: TEST_SUITE_ENTERPRISE_LICENSE_KEY, source: "test-suite" });
      });
    });
  });

  describe("given a private key that does not pair with the boot public key", () => {
    describe("when the seed runs", () => {
      /** @scenario "A private key that does not pair with the boot public key is refused" */
      it("stores no licence", () => {
        expect(
          chooseSeedLicense({
            stored: null,
            publicKey: dev.publicKey,
            privateKey: stranger.privateKey,
            organization: ORGANIZATION,
          }),
        ).toEqual({ licenseKey: null, reason: "unpaired-private-key" });
      });
    });
  });
});
