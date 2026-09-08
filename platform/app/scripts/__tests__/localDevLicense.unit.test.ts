import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ENTERPRISE_LICENSE_KEY as EE_TEST_FIXTURE_LICENSE_KEY } from "../../ee/licensing/__tests__/fixtures/testLicenses";
// The key the app boots with when LANGWATCH_LICENSE_PUBLIC_KEY is unset,
// which is what `haven up` runs. The vitest setup swaps `PUBLIC_KEY` for the
// test-suite key, so that export would test the wrong deployment.
import { PLACEHOLDER_PUBLIC_KEY as PUBLIC_KEY } from "../../ee/licensing/constants";
import {
  parseLicenseKey,
  verifySignature,
} from "../../ee/licensing/validation";
import {
  LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
  resolveSeedLicense,
} from "../localDevLicense";

function isSignedByLangWatch(licenseKey: string): boolean {
  const parsed = parseLicenseKey(licenseKey);
  return parsed !== null && verifySignature(parsed, PUBLIC_KEY);
}

describe("localDevLicense", () => {
  describe("given the verification key the app boots with", () => {
    it("verifies the local-dev enterprise license", () => {
      expect(isSignedByLangWatch(LOCAL_DEV_ENTERPRISE_LICENSE_KEY)).toBe(true);
    });

    // Documents why the seed must never write the ee test fixture: it is
    // signed with the test-suite private key, so the running app reports it
    // as an invalid license on every settings page.
    it("rejects the ee test fixture license", () => {
      expect(isSignedByLangWatch(EE_TEST_FIXTURE_LICENSE_KEY)).toBe(false);
    });
  });

  describe("resolveSeedLicense", () => {
    describe("when the organization has no license yet", () => {
      it("returns the local-dev enterprise license", () => {
        expect(
          resolveSeedLicense({ stored: null, publicKey: PUBLIC_KEY }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });

    describe("when the stored license does not verify", () => {
      it("replaces an unreadable value", () => {
        expect(
          resolveSeedLicense({
            stored: "not-a-license",
            publicKey: PUBLIC_KEY,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });

      it("replaces a fixture left behind by an older seed", () => {
        expect(
          resolveSeedLicense({
            stored: EE_TEST_FIXTURE_LICENSE_KEY,
            publicKey: PUBLIC_KEY,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });

    describe("when the stored license already verifies", () => {
      it("keeps it, so a re-seed never clobbers a license someone activated", () => {
        const activated = LOCAL_DEV_ENTERPRISE_LICENSE_KEY;
        expect(
          resolveSeedLicense({ stored: activated, publicKey: PUBLIC_KEY }),
        ).toBe(activated);
      });
    });
  });

  describe("prisma/seed.ts", () => {
    it("does not source its license from the ee test fixtures", () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, "../../prisma/seed.ts"),
        "utf8",
      );
      expect(source).not.toMatch(/ee\/licensing\/__tests__/);
    });
  });
});
