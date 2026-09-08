import { describe, expect, it } from "vitest";
import { TEST_PUBLIC_KEY } from "../../ee/licensing/__tests__/fixtures/testKeys";
import { ENTERPRISE_LICENSE_KEY as TEST_SUITE_LICENSE_KEY } from "../../ee/licensing/__tests__/fixtures/testLicenses";
// The key the app boots with when LANGWATCH_LICENSE_PUBLIC_KEY is unset,
// which is what `haven up` runs. The vitest setup swaps `PUBLIC_KEY` for the
// test-suite key, so that export would test the wrong deployment.
import { PLACEHOLDER_PUBLIC_KEY as DEFAULT_PUBLIC_KEY } from "../../ee/licensing/constants";
import {
  parseLicenseKey,
  verifySignature,
} from "../../ee/licensing/validation";
import {
  LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
  resolveSeedLicense,
} from "../localDevLicense";

function isSignedFor(licenseKey: string, publicKey: string): boolean {
  const parsed = parseLicenseKey(licenseKey);
  return parsed !== null && verifySignature(parsed, publicKey);
}

const SEED_CANDIDATES = [
  LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
  TEST_SUITE_LICENSE_KEY,
] as const;

describe("LOCAL_DEV_ENTERPRISE_LICENSE_KEY", () => {
  describe("when verified with the key the app boots with by default", () => {
    it("verifies", () => {
      expect(
        isSignedFor(LOCAL_DEV_ENTERPRISE_LICENSE_KEY, DEFAULT_PUBLIC_KEY),
      ).toBe(true);
    });

    // Documents why the seed used to show an invalid license: the ee fixture
    // is signed with the test-suite private key, not the default one.
    it("rejects the ee test fixture license", () => {
      expect(isSignedFor(TEST_SUITE_LICENSE_KEY, DEFAULT_PUBLIC_KEY)).toBe(
        false,
      );
    });
  });
});

describe("resolveSeedLicense", () => {
  describe("given the app boots with the default key", () => {
    describe("when the organization has no license yet", () => {
      it("returns the local-dev enterprise license", () => {
        expect(
          resolveSeedLicense({
            stored: null,
            publicKey: DEFAULT_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });

    describe("when the stored license does not verify", () => {
      it("replaces an unreadable value", () => {
        expect(
          resolveSeedLicense({
            stored: "not-a-license",
            publicKey: DEFAULT_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });

      it("replaces a fixture left behind by an older seed", () => {
        expect(
          resolveSeedLicense({
            stored: TEST_SUITE_LICENSE_KEY,
            publicKey: DEFAULT_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });

    describe("when the stored license already verifies", () => {
      it("keeps it, so a re-seed never clobbers a license someone activated", () => {
        const activated = LOCAL_DEV_ENTERPRISE_LICENSE_KEY;
        expect(
          resolveSeedLicense({
            stored: activated,
            publicKey: DEFAULT_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(activated);
      });
    });
  });

  describe("given the app boots with the test-suite key, as CI seeds do", () => {
    describe("when the organization has no license yet", () => {
      it("returns the ee test fixture, the candidate that verifies there", () => {
        expect(
          resolveSeedLicense({
            stored: null,
            publicKey: TEST_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(TEST_SUITE_LICENSE_KEY);
      });
    });
  });

  describe("given no candidate verifies against the boot key", () => {
    describe("when the organization has no license yet", () => {
      it("falls back to the first candidate so the org still has a readable license", () => {
        expect(
          resolveSeedLicense({
            stored: null,
            publicKey:
              "-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----",
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });
  });
});
