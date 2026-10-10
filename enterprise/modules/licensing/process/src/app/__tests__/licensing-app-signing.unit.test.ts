/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { createTestLicensingApp } from "../../__tests__/testing.ts";
import type { LicensingModule } from "../licensing.app.ts";

const PURCHASE = {
  organizationName: "Acme",
  email: "buyer@acme.example",
  planType: "GROWTH",
  maxMembers: 4,
};

function licensingWithSigningKey(signingKey: string | undefined): Promise<LicensingModule> {
  return createTestLicensingApp({
    config: { isSaas: true },
    secrets: { LANGWATCH_LICENSE_PRIVATE_KEY: signingKey },
    role: "api",
  });
}

describe("a licence a peer asks licensing to sign", () => {
  describe("given the deployment holds the licence signing key", () => {
    /** @scenario "Licensing signs a purchased licence with its own key" */
    it("signs it, and the licence verifies against LangWatch's public key", async () => {
      const app = await licensingWithSigningKey(TEST_PRIVATE_KEY);

      const { licenseKey, licenseData } = await app.generateLicenseKey(PURCHASE);

      expect(licenseData).toMatchObject({ organizationName: "Acme", plan: { type: "GROWTH" } });
      expect(
        NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY }).validateLicense({
          licenseKey,
        }),
      ).toMatchObject({ valid: true });
    });
  });

  describe("given the deployment holds no licence signing key", () => {
    /** @scenario "A deployment without the licence signing key refuses to sign by name" */
    it("refuses with the signing-not-configured code", async () => {
      const app = await licensingWithSigningKey(undefined);

      await expect(app.generateLicenseKey(PURCHASE)).rejects.toMatchObject({
        code: "license_signing_not_configured",
      });
    });
  });
});
