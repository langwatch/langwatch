/**
 * Replacing a stored licence, a licence set in the environment, and a licence
 * entered on the wrong organization.
 * @see specs/licensing/license-renewal.feature
 * @see specs/licensing/license-page-actions.feature
 */
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import { LICENSE_ERRORS, licenseValidationError } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { LicenseService } from "../services/license.service.ts";
import {
  MemoryLicenseStorage,
  TAMPERED_LICENSE_KEY,
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "./testing.ts";

const ORGANIZATION_ID = "org-acme";

function mintLicenseKey({
  organizationId,
  planType = "ENTERPRISE",
  maxMembers = 40,
}: {
  organizationId?: string;
  planType?: string;
  maxMembers?: number;
} = {}): string {
  return LicenseGenerationService.create(NodeLicenseCryptographyService.create()).generate({
    ...(organizationId ? { organizationId } : {}),
    organizationName: "ACME",
    email: "ops@example.com",
    planType,
    maxMembers,
    privateKey: TEST_PRIVATE_KEY,
  }).licenseKey;
}

function serviceOver({
  repository,
  instanceLicenseKey,
}: {
  repository: MemoryLicenseStorage;
  instanceLicenseKey?: string;
}): LicenseService {
  return LicenseService.create({
    repository,
    cryptography: NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY }),
    instanceLicenseKey,
  });
}

const storage = () => MemoryLicenseStorage.create({ organizations: [ORGANIZATION_ID] });

describe("replacing an installed licence", () => {
  /** @scenario A replacement that does not verify keeps the current licence */
  it("refuses a forged replacement with license_key_invalid and keeps the installed key", async () => {
    const repository = storage();
    const service = serviceOver({ repository });
    const installed = mintLicenseKey({ maxMembers: 10 });
    await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: installed,
    });

    const result = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: TAMPERED_LICENSE_KEY,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(licenseValidationError(result.error).code).toBe("license_key_invalid");
    expect(repository.stored.get(ORGANIZATION_ID)?.licenseKey).toBe(installed);
  });
});

describe("a licence set in LANGWATCH_LICENSE_KEY", () => {
  /** @scenario A signed key in LANGWATCH_LICENSE_KEY sets the plan of an organization with no stored licence */
  it("resolves the plan the environment licence signs", async () => {
    const service = serviceOver({
      repository: storage(),
      instanceLicenseKey: mintLicenseKey({ maxMembers: 40 }),
    });

    const plan = await service.getSelfHostedPlan(ORGANIZATION_ID);

    expect(plan.type).toBe("ENTERPRISE");
    expect(plan.maxMembers).toBe(40);
    const status = await service.getLicenseStatus(ORGANIZATION_ID);
    expect(status).toMatchObject({ hasLicense: true, valid: true, source: "environment" });
  });

  /** @scenario A stored licence wins over the environment licence */
  it("resolves the stored licence's plan when the organization stored one", async () => {
    const repository = storage();
    const service = serviceOver({
      repository,
      instanceLicenseKey: mintLicenseKey({ maxMembers: 40 }),
    });
    await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: mintLicenseKey({ planType: "GROWTH", maxMembers: 7 }),
    });

    const plan = await service.getSelfHostedPlan(ORGANIZATION_ID);

    expect(plan.type).toBe("GROWTH");
    expect(plan.maxMembers).toBe(7);
    const status = await service.getLicenseStatus(ORGANIZATION_ID);
    expect(status).toMatchObject({ source: "stored" });
  });

  /** @scenario An environment licence for another organization does not license this one */
  it("leaves this organization on the open source plan", async () => {
    const service = serviceOver({
      repository: storage(),
      instanceLicenseKey: mintLicenseKey({ organizationId: "org-other" }),
    });

    const plan = await service.getSelfHostedPlan(ORGANIZATION_ID);

    expect(plan.free).toBe(true);
    expect(await service.getLicenseStatus(ORGANIZATION_ID)).toEqual({
      hasLicense: false,
      valid: false,
    });
  });
});

describe("a licence entered on the wrong organization", () => {
  /** @scenario A licence for another organization has its own refusal */
  it("refuses it with license_organization_mismatch, and a forged key with license_key_invalid", async () => {
    const service = serviceOver({ repository: storage() });

    const mismatch = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: mintLicenseKey({ organizationId: "org-other" }),
    });
    const forged = await service.validateAndStoreLicense({
      organizationId: ORGANIZATION_ID,
      licenseKey: TAMPERED_LICENSE_KEY,
    });

    expect(mismatch).toEqual({ success: false, error: LICENSE_ERRORS.ORGANIZATION_MISMATCH });
    expect(licenseValidationError(LICENSE_ERRORS.ORGANIZATION_MISMATCH).code).toBe(
      "license_organization_mismatch",
    );
    expect(forged.success).toBe(false);
    if (forged.success) return;
    expect(licenseValidationError(forged.error).code).toBe("license_key_invalid");
  });
});
