import { describe, expect, it } from "vitest";
import { EnterpriseWebComposition } from "../src";

describe("EnterpriseWebComposition", () => {
  it("retains portable initial license status", () => {
    const initialLicenseStatus = { hasLicense: false, valid: false } as const;
    const composition = EnterpriseWebComposition.create({
      initialLicenseStatus,
    });

    expect(composition.initialLicenseStatus).toBe(initialLicenseStatus);
  });
});
