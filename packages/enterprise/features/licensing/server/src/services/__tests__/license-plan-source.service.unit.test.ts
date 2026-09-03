import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";
import { NodeLicenseCryptographyAdapter } from "../../adapters/node.license-cryptography.adapter";
import { LicensingEntitlementSource } from "../../adapters/licensing.entitlement-source.adapter";
import { OrganizationLicensePort } from "../../ports/organization-license.port";
import {
  ENTERPRISE_LICENSE_KEY,
  EXPIRED_ENTERPRISE_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  TEST_PUBLIC_KEY,
} from "../../testing";
import { LicensePlanSourceService } from "../license-plan-source.service";

/**
 * Spec: packages/enterprise/features/licensing/specs/licensing.feature
 *
 * The licence leg of plan resolution, over the REAL verifier. Nothing here is
 * a stub below the licence row: the keys are genuinely signed fixtures and the
 * signatures are genuinely checked, because the whole question this service
 * answers is whether a signature holds.
 */

/** The one read the licence leg makes; nothing else is exercised. */
class StoredLicense extends OrganizationLicensePort {
  static of(licenseKey: string | null): StoredLicense {
    return new StoredLicense(licenseKey);
  }

  private constructor(private readonly licenseKey: string | null) {
    super();
  }

  async tryReadLicense(): Promise<string | null> {
    return this.licenseKey;
  }
}

const cryptography = NodeLicenseCryptographyAdapter.create({ publicKey: TEST_PUBLIC_KEY });

function planSourceFor(licenseKey: string | null): LicensePlanSourceService {
  return LicensePlanSourceService.create({
    licenses: StoredLicense.of(licenseKey),
    cryptography,
  });
}

describe("given the plan a signed licence entitles an organization to", () => {
  describe("when the organization activated no licence", () => {
    it("answers the unlimited baseline on both readings, so nothing narrows an unlicensed deployment", async () => {
      const plans = planSourceFor(null);

      await expect(plans.getActivePlan("org-1")).resolves.toBe(UNLIMITED_PLAN);
      await expect(plans.getSelfHostedPlan("org-1")).resolves.toBe(UNLIMITED_PLAN);
    });
  });

  describe("when the stored licence was tampered with", () => {
    it("answers the unlimited baseline rather than the plan the payload claims", async () => {
      const plans = planSourceFor(TAMPERED_LICENSE_KEY);

      await expect(plans.getActivePlan("org-1")).resolves.toBe(UNLIMITED_PLAN);
      await expect(plans.getSelfHostedPlan("org-1")).resolves.toBe(UNLIMITED_PLAN);
    });
  });

  describe("when the organization holds a genuine Enterprise licence", () => {
    it("answers the plan the licence names", async () => {
      const plans = planSourceFor(ENTERPRISE_LICENSE_KEY);

      await expect(plans.getActivePlan("org-1")).resolves.toMatchObject({
        type: "ENTERPRISE",
        free: false,
        maxMembers: 100,
        planSource: "license",
      });
    });
  });

  describe("when a genuine licence's term has ended", () => {
    /**
     * The two readings deliberately disagree, and ADR-027 is why. On Cloud the
     * licence is a contract with a term, so a lapsed one steps aside and the
     * subscription underneath takes over. Self-hosted reads the signature
     * only — once a customer, never blocked — because cutting a whole
     * company's Enterprise surface on a routine upgrade is a blast radius the
     * product does not have.
     */
    /** @scenario "Preserve a lapsed self-hosted purchase" */
    /** @scenario "Let a lapsed Cloud override step aside" */
    it("steps aside on the hosted reading and still holds on the self-hosted one", async () => {
      const plans = planSourceFor(EXPIRED_ENTERPRISE_LICENSE_KEY);

      await expect(plans.getActivePlan("org-1")).resolves.toBe(UNLIMITED_PLAN);
      await expect(plans.getSelfHostedPlan("org-1")).resolves.toMatchObject({
        type: "ENTERPRISE",
        free: false,
        maxMembers: 100,
      });
    });
  });
});

describe("given the licence leg a deployment composes", () => {
  describe("when the deployment is the hosted one", () => {
    /** @scenario "Let a lapsed Cloud override step aside" */
    it("reads the licence on the hosted terms, so a lapsed contract stops answering", async () => {
      const source = LicensingEntitlementSource.forDeployment({
        licenses: StoredLicense.of(EXPIRED_ENTERPRISE_LICENSE_KEY),
        cryptography,
        isSaas: true,
      });

      await expect(source.resolve({ organizationId: "org-1" })).resolves.toBe(UNLIMITED_PLAN);
    });
  });

  describe("when the deployment is self-hosted", () => {
    /**
     * The mode is derived HERE rather than at each root, which is what this
     * pins: the interactive and background processes both call this, so a
     * lapsed self-hosted licence cannot keep its seats in one process and lose
     * them in the other.
     */
    /** @scenario "Preserve a lapsed self-hosted purchase" */
    it("reads the licence on the self-hosted terms and floors it at the open-source baseline", async () => {
      const source = LicensingEntitlementSource.forDeployment({
        licenses: StoredLicense.of(EXPIRED_ENTERPRISE_LICENSE_KEY),
        cryptography,
        isSaas: false,
      });

      await expect(source.resolve({ organizationId: "org-1" })).resolves.toMatchObject({
        type: "ENTERPRISE",
        // The seats the customer bought bind; the licence's message ceiling
        // does not, because self-hosted volume is never metered.
        maxMembers: 100,
        maxMessagesPerMonth: UNLIMITED_PLAN.maxMessagesPerMonth,
      });
    });

    it("answers the unlimited baseline where no licence was activated", async () => {
      const source = LicensingEntitlementSource.forDeployment({
        licenses: StoredLicense.of(null),
        cryptography,
        isSaas: false,
      });

      await expect(source.resolve({ organizationId: "org-1" })).resolves.toBe(UNLIMITED_PLAN);
    });
  });
});
