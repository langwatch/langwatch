/**
 * @vitest-environment node
 * @see specs/licensing/license-signing-key.feature
 */
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import { LICENSE_ERRORS } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
  WRONG_PRIVATE_KEY,
  WRONG_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { licenseVerifyingKeyOf } from "../license-verifying-key.rules.ts";

function signedWith({ privateKey }: { privateKey: string }): string {
  return LicenseGenerationService.create(NodeLicenseCryptographyService.create()).generate({
    organizationName: "Acme Corp",
    email: "buyer@acme.com",
    planType: "GROWTH",
    maxMembers: 5,
    privateKey,
    now: new Date("2025-06-15T12:00:00Z"),
  }).licenseKey;
}

/** A licence carrying the `devStack` claim, signed as a haven stack signs it. */
function devStackSignedWith({ privateKey }: { privateKey: string }): string {
  const cryptography = NodeLicenseCryptographyService.create();
  const signed = cryptography.parseLicenseKey(signedWith({ privateKey }));
  if (!signed) throw new Error("fixture licence did not parse");
  return cryptography.encodeLicenseKey(
    cryptography.signLicense({ ...signed.data, devStack: true }, privateKey),
  );
}

/** Whether the signature verifies under the key a build picks; expiry is out of scope. */
function verifies({
  licenseKey,
  override,
  isReleaseBuild,
}: {
  licenseKey: string;
  override: string | undefined;
  isReleaseBuild: boolean;
}): boolean {
  const { publicKey, refuseDevStack } = licenseVerifyingKeyOf({ override, isReleaseBuild });
  const cryptography = NodeLicenseCryptographyService.create({ publicKey, refuseDevStack });
  const signed = cryptography.parseLicenseKey(licenseKey);
  return signed !== null && cryptography.verifySignature(signed);
}

describe("the key a release build verifies licences with", () => {
  /** @scenario "A release build ignores the public-key override and verifies with the embedded key" */
  it("sets the override aside for the embedded key", () => {
    const otherSigned = signedWith({ privateKey: WRONG_PRIVATE_KEY });

    expect(
      licenseVerifyingKeyOf({ override: WRONG_PUBLIC_KEY, isReleaseBuild: true }).publicKey,
    ).toBeUndefined();
    expect(
      verifies({ licenseKey: otherSigned, override: WRONG_PUBLIC_KEY, isReleaseBuild: true }),
    ).toBe(false);
  });

  /** @scenario "A release build refuses a licence signed by the test key" */
  it("refuses a test-signed licence though the override names the test key", () => {
    const testSigned = signedWith({ privateKey: TEST_PRIVATE_KEY });

    expect(
      verifies({ licenseKey: testSigned, override: TEST_PUBLIC_KEY, isReleaseBuild: true }),
    ).toBe(false);
  });

  /** @scenario "A release build boots when the override is not a valid key" */
  it("uses the embedded key when the override is not a PEM key", () => {
    expect(
      licenseVerifyingKeyOf({ override: "not a key", isReleaseBuild: true }).publicKey,
    ).toBeUndefined();
    expect(
      verifies({
        licenseKey: signedWith({ privateKey: TEST_PRIVATE_KEY }),
        override: "not a key",
        isReleaseBuild: true,
      }),
    ).toBe(false);
  });
});

describe("what a release build says about the override", () => {
  /** @scenario "The boot log names the ignored override" */
  it("names the ignored variable and never the key", () => {
    const picked = licenseVerifyingKeyOf({ override: TEST_PUBLIC_KEY, isReleaseBuild: true });

    expect(picked.ignoredVariable).toBe("LANGWATCH_LICENSE_PUBLIC_KEY");
    expect(JSON.stringify(picked)).not.toContain("BEGIN PUBLIC KEY");
  });

  /** @scenario "A release build without the override logs nothing about it" */
  it("names nothing when no override is set", () => {
    expect(
      licenseVerifyingKeyOf({ override: undefined, isReleaseBuild: true }).ignoredVariable,
    ).toBeUndefined();
  });
});

describe("the key a development build verifies licences with", () => {
  /** @scenario "A development build honours the public-key override" */
  it("accepts a test-signed licence under the test key", () => {
    const testSigned = signedWith({ privateKey: TEST_PRIVATE_KEY });

    expect(
      verifies({ licenseKey: testSigned, override: TEST_PUBLIC_KEY, isReleaseBuild: false }),
    ).toBe(true);
  });

  /** @scenario "A development build with the override refuses a licence signed by another key" */
  it("refuses a licence signed by another key", () => {
    const otherSigned = signedWith({ privateKey: WRONG_PRIVATE_KEY });

    expect(
      verifies({ licenseKey: otherSigned, override: TEST_PUBLIC_KEY, isReleaseBuild: false }),
    ).toBe(false);
    expect(
      licenseVerifyingKeyOf({ override: TEST_PUBLIC_KEY, isReleaseBuild: false }).ignoredVariable,
    ).toBeUndefined();
  });

  /** @scenario "A development build without the override verifies with the embedded key" */
  it("picks the embedded key, which refuses a test-signed licence", () => {
    expect(
      licenseVerifyingKeyOf({ override: undefined, isReleaseBuild: false }).publicKey,
    ).toBeUndefined();
    expect(
      verifies({
        licenseKey: signedWith({ privateKey: TEST_PRIVATE_KEY }),
        override: undefined,
        isReleaseBuild: false,
      }),
    ).toBe(false);
  });
});

describe("a dev stack licence", () => {
  /** @scenario "A release build refuses a dev stack licence whatever key signed it" */
  it("is refused by a release build even when its verifying key signed it", () => {
    const { refuseDevStack } = licenseVerifyingKeyOf({
      override: TEST_PUBLIC_KEY,
      isReleaseBuild: true,
    });
    const cryptography = NodeLicenseCryptographyService.create({
      publicKey: TEST_PUBLIC_KEY,
      refuseDevStack,
    });

    expect(refuseDevStack).toBe(true);
    expect(
      cryptography.validateLicense({
        licenseKey: devStackSignedWith({ privateKey: TEST_PRIVATE_KEY }),
      }),
    ).toEqual({ valid: false, error: LICENSE_ERRORS.INVALID_SIGNATURE });
  });

  /** @scenario "A development build accepts a dev stack licence signed by its override key" */
  it("is accepted by a development build under the override key", () => {
    expect(
      verifies({
        licenseKey: devStackSignedWith({ privateKey: TEST_PRIVATE_KEY }),
        override: TEST_PUBLIC_KEY,
        isReleaseBuild: false,
      }),
    ).toBe(true);
  });

  /** @scenario "A verifier that is not told its build refuses a dev stack licence" */
  it("is refused by a verifier constructed without the build's answer", () => {
    const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
    const signed = cryptography.parseLicenseKey(
      devStackSignedWith({ privateKey: TEST_PRIVATE_KEY }),
    );

    expect(signed?.data.devStack).toBe(true);
    expect(signed && cryptography.verifySignature(signed)).toBe(false);
  });
});
