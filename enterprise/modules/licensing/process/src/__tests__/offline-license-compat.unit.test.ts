/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/license-sync.feature
 *
 * Existing offline licenses keep working (ADR-156, "Existing offline licenses"):
 * no Connect configuration, no registry, no network.
 */
import { readFileSync } from "node:fs";

import {
  DEFAULT_LICENSE_PUBLIC_KEY,
  mapToPlanInfo,
} from "@langwatch/enterprise-licensing-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LicenseStorage, StoredLicense } from "../app/licensing.members.ts";
import { connectServicesNamedBy } from "../rules/connect-entitlement.rules.ts";
import { LicenseService } from "../services/license.service.ts";
import { NodeLicenseCryptographyAdapter } from "../services/node-license-cryptography.service.ts";
import { OFFLINE_LICENSE_FROM_MAIN as fixture } from "./support/offline-license-from-main.fixture.ts";

const ORG = "org_offline";

/** An offline install's database: one organization holding the license main minted. */
class OfflineLicenseStorage implements LicenseStorage {
  constructor(
    private readonly licenseKey: string,
    private readonly memberCount: number,
  ) {}

  async tryReadLicense(organizationId: string): Promise<string | null> {
    return organizationId === ORG ? this.licenseKey : null;
  }

  async findOrganizationsWithLicense() {
    return [{ organizationId: ORG, licenseKey: this.licenseKey }];
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return organizationId === ORG;
  }

  async storeLicense(_organizationId: string, _license: StoredLicense): Promise<void> {
    throw new Error("an offline install stored a license it only had to read");
  }

  async removeLicense(): Promise<void> {
    throw new Error("an offline install removed a license it only had to read");
  }

  async getMemberCount(): Promise<number> {
    return this.memberCount;
  }

  async getMembersLiteCount(): Promise<number> {
    return 0;
  }
}

const cryptography = NodeLicenseCryptographyAdapter.create({ publicKey: fixture.publicKey });

function offlineInstall(memberCount = 0): LicenseService {
  return LicenseService.create({
    repository: new OfflineLicenseStorage(fixture.licenseKey, memberCount),
    cryptography,
  });
}

describe("a license minted by main before Connect", () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("offline license validation attempted a network call");
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when it is validated on this branch", () => {
    it("verifies with the same key and yields the same signed data", () => {
      const verdict = cryptography.validateLicense({ licenseKey: fixture.licenseKey });

      expect(verdict.valid).toBe(true);
      if (!verdict.valid) return;
      expect(verdict.licenseData).toEqual(fixture.expected);
    });

    it("re-serializes byte for byte, so the signature still covers the same schema", () => {
      const parsed = cryptography.parseLicenseKey(fixture.licenseKey);

      expect(JSON.stringify(parsed?.data)).toBe(JSON.stringify(fixture.expected));
    });

    it("maps to the same plan limits", () => {
      const verdict = cryptography.validateLicense({ licenseKey: fixture.licenseKey });
      if (!verdict.valid) throw new Error("the fixture must validate");

      expect(mapToPlanInfo(verdict.licenseData)).toMatchObject({
        maxMembers: fixture.expected.plan.maxMembers,
        maxMembersLite: fixture.expected.plan.maxMembersLite,
      });
    });

    it("is still verified against the production public key main shipped", () => {
      expect(DEFAULT_LICENSE_PUBLIC_KEY.trim()).toBe(fixture.productionPublicKey.trim());
    });

    it("names no hosted service, so no path builds a Connect client", () => {
      const verdict = cryptography.validateLicense({ licenseKey: fixture.licenseKey });
      if (!verdict.valid) throw new Error("the fixture must validate");

      expect(connectServicesNamedBy(verdict.licenseData.connectServices)).toEqual([]);
    });
  });

  describe("when an install with no Connect configuration enforces it", () => {
    it("resolves the seat counts signed into the license", async () => {
      const plan = await offlineInstall().getSelfHostedPlan(ORG);

      expect(plan.maxMembers).toBe(fixture.expected.plan.maxMembers);
      expect(plan.maxMembersLite).toBe(fixture.expected.plan.maxMembersLite);
    });

    it("reports the same license status, not connected", async () => {
      const status = await offlineInstall(3).getLicenseStatus(ORG);

      expect(status).toMatchObject({
        hasLicense: true,
        valid: true,
        organizationName: fixture.expected.organizationName,
        maxMembers: fixture.expected.plan.maxMembers,
        currentMembers: 3,
        connected: false,
      });
    });

    it("makes no network call", async () => {
      const install = offlineInstall(fixture.expected.plan.maxMembers);

      await install.getSelfHostedPlan(ORG);
      await install.getActivePlan(ORG);
      await install.getLicenseStatus(ORG);

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

/** What runs inside an install to read, verify and enforce a license. */
const INSTALL_SIDE_MODULES = [
  "../services/license.service.ts",
  "../services/license-plan-source.service.ts",
  "../services/licensing-entitlement-source.service.ts",
  "../services/node-license-cryptography.service.ts",
  "../rules/connect-entitlement.rules.ts",
];

describe("the modules that validate or enforce a license", () => {
  it("never import the license registry, which exists only on LangWatch Cloud", () => {
    const offenders = INSTALL_SIDE_MODULES.filter((module) =>
      /from\s+"[^"]*issued-license/.test(readFileSync(new URL(module, import.meta.url), "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
