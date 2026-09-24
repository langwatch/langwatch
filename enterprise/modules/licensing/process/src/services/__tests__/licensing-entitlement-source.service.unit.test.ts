import type { OrganizationLicense } from "@langwatch/enterprise-licensing-process";
import {
  ENTERPRISE_LICENSE_KEY,
  EXPIRED_ENTERPRISE_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  TEST_PUBLIC_KEY,
} from "@langwatch/enterprise-licensing-process/testing";
import { describe, expect, it } from "vitest";

import { LicensingEntitlementSourceAdapter } from "../licensing-entitlement-source.service.ts";
import { NodeLicenseCryptographyAdapter } from "../node-license-cryptography.service.ts";

/**
 * Spec: specs/licensing/management-apis-enterprise-gate.feature. The four
 * resolution cases, exercised with REAL signature verification against a
 * plain `OrganizationLicense` fake — no Prisma double, no cast needed.
 */

/** The license row, as `PrismaOrganizationLicenseRepository` would read it. */
function licenses(licenseKey: string | null): OrganizationLicense {
  return { getOrganizationLicense: async () => ({ licenseKey }) };
}

function cloudSource(licenseKey: string | null): LicensingEntitlementSourceAdapter {
  return LicensingEntitlementSourceAdapter.forDeployment({
    licenses: licenses(licenseKey),
    cryptography: NodeLicenseCryptographyAdapter.create({ publicKey: TEST_PUBLIC_KEY }),
    isSaas: true,
  });
}

describe("given the licence leg of a hosted deployment's plan resolution", () => {
  /** @scenario "A valid signed unexpired Enterprise license resolves the Enterprise plan" */
  it("resolves ENTERPRISE for a valid, unexpired, correctly signed license", async () => {
    const source = cloudSource(ENTERPRISE_LICENSE_KEY);

    const plan = await source.resolve({ organizationId: "org-1" });

    expect(plan?.type).toBe("ENTERPRISE");
    expect(plan?.free).toBe(false);
  });

  /** @scenario "An absent license resolves the baseline plan" */
  it("answers unlicensed when no license key is stored for the organization", async () => {
    const source = cloudSource(null);

    const plan = await source.resolve({ organizationId: "org-1" });

    expect(plan?.free).toBe(true);
  });

  /** @scenario "A license with an invalid signature resolves the baseline plan" */
  it("answers unlicensed when the stored license's signature does not verify", async () => {
    const source = cloudSource(TAMPERED_LICENSE_KEY);

    const plan = await source.resolve({ organizationId: "org-1" });

    expect(plan?.free).toBe(true);
  });

  /** @scenario "An expired license resolves the baseline plan" */
  it("answers unlicensed when the stored license's term has lapsed", async () => {
    // The Cloud reading checks signature AND term (unlike the self-hosted
    // reading, which is signature-only under ADR-027), so a genuinely
    // expired, correctly signed Enterprise license still degrades here.
    const source = cloudSource(EXPIRED_ENTERPRISE_LICENSE_KEY);

    const plan = await source.resolve({ organizationId: "org-1" });

    expect(plan?.free).toBe(true);
  });
});
