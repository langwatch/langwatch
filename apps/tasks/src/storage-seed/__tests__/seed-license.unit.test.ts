import { DEFAULT_LICENSE_PUBLIC_KEY } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import {
  isSignedFor,
  LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
  resolveSeedLicense,
  TEST_SUITE_ENTERPRISE_LICENSE_KEY as TEST_SUITE_LICENSE_KEY,
} from "../seed-license.ts";

/** The public half of the licensing test suite's key pair, which signs TEST_SUITE_LICENSE_KEY. */
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApmJ61eRR1wxrapjipSmN
IqYMJPmbonA1d6XV51kdnVs/MdNrrdoWIal6TDt2lHvbAbrEalqR7h+vQzBBZ4St
ZPqBzTIHQwu3Wjlj7Fj7IeVUiJnRg60W+u9DmYXUeFBlZFMHxV3nNVqedwDcFpV/
IrAMmSe3QeTqBztcDMBxu5luA4DMU5Hi6kp4qcHDoCCiEH4a6ZZkPdNC+xpFdW41
75BwdKBKnyOZrUvyPaKrxInra7z+9YQKiggRciQvCNxc76Ef4DLGkTIf36Cvm7XL
m0gqlJm89dYcRBaDVGFTnb98BM7SrAIg117yjuuw5o/RmSlKq9/Klkz0QsXYF9Zj
iQIDAQAB
-----END PUBLIC KEY-----`;

const SEED_CANDIDATES = [LOCAL_DEV_ENTERPRISE_LICENSE_KEY, TEST_SUITE_LICENSE_KEY] as const;

describe("LOCAL_DEV_ENTERPRISE_LICENSE_KEY", () => {
  describe("given the app boots with the default key", () => {
    describe("when the local-dev license is verified", () => {
      it("verifies", () => {
        expect(
          isSignedFor({
            licenseKey: LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
            publicKey: DEFAULT_LICENSE_PUBLIC_KEY,
          }),
        ).toBe(true);
      });
    });

    // Documents why the seed used to show an invalid license: the ee fixture
    // is signed with the test-suite private key, not the default one.
    describe("when the ee test fixture license is verified", () => {
      it("rejects it", () => {
        expect(
          isSignedFor({
            licenseKey: TEST_SUITE_LICENSE_KEY,
            publicKey: DEFAULT_LICENSE_PUBLIC_KEY,
          }),
        ).toBe(false);
      });
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
            publicKey: DEFAULT_LICENSE_PUBLIC_KEY,
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
            publicKey: DEFAULT_LICENSE_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });

      it("replaces a fixture left behind by an older seed", () => {
        expect(
          resolveSeedLicense({
            stored: TEST_SUITE_LICENSE_KEY,
            publicKey: DEFAULT_LICENSE_PUBLIC_KEY,
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });

    describe("when the stored license already verifies", () => {
      it("keeps it, so a re-seed never clobbers a license someone activated", () => {
        const activated = LOCAL_DEV_ENTERPRISE_LICENSE_KEY;
        // Candidates deliberately exclude the stored key, so a resolver that
        // skipped the stored branch could not pass by coincidence.
        expect(
          resolveSeedLicense({
            stored: activated,
            publicKey: DEFAULT_LICENSE_PUBLIC_KEY,
            candidates: [TEST_SUITE_LICENSE_KEY],
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
            publicKey: "-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----",
            candidates: SEED_CANDIDATES,
          }),
        ).toBe(LOCAL_DEV_ENTERPRISE_LICENSE_KEY);
      });
    });
  });
});
