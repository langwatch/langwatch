import { describe, expect, it, vi } from "vitest";

import { NodeLicenseCryptographyAdapter } from "../adapters/node.license-cryptography.adapter";
import { TEST_PUBLIC_KEY, ENTERPRISE_LICENSE_KEY } from "../testing";
import { LicenseService } from "../services/license.service";
import { LicenseStoragePort, type StoredLicense } from "../ports/license-storage.port";

/**
 * @see specs/licensing/seat-reconciliation.feature
 *
 * A self-hosted deployment runs uncapped without a license, so an
 * organization can already hold more active members than the seats a newly
 * bought license names. Activation must not fail on that: the org lands in an
 * over-seats state (enforced at invite time — see
 * invite-seat-reconciliation.unit.test.ts — and the license page) rather than
 * being locked out of activating the license that is meant to fix it.
 */
class InMemoryLicenseStorage extends LicenseStoragePort {
  private stored: StoredLicense | null = null;

  constructor(private readonly memberCount: number) {
    super();
  }

  async tryReadLicense(): Promise<string | null> {
    return this.stored?.licenseKey ?? null;
  }
  async findOrganizationsWithLicense() {
    return [];
  }
  async organizationExists(): Promise<boolean> {
    return true;
  }
  async storeLicense(_organizationId: string, license: StoredLicense): Promise<void> {
    this.stored = license;
  }
  async removeLicense(): Promise<void> {
    this.stored = null;
  }
  async getMemberCount(): Promise<number> {
    return this.memberCount;
  }
  async getMembersLiteCount(): Promise<number> {
    return 0;
  }
}

describe("given an organization with 25 active members and no license yet", () => {
  describe("when an admin activates a license for 10 members", () => {
    /** @scenario "Activating a license for fewer seats than the org has succeeds" */
    it("stores the license as active without regard to the current headcount", async () => {
      const storage = new InMemoryLicenseStorage(25);
      const service = LicenseService.create({
        repository: storage,
        cryptography: NodeLicenseCryptographyAdapter.create({ publicKey: TEST_PUBLIC_KEY }),
        retention: { provisionMissingPolicies: vi.fn() } as never,
      });

      const result = await service.validateAndStoreLicense({
        organizationId: "org-123",
        licenseKey: ENTERPRISE_LICENSE_KEY,
      });

      expect(result).toMatchObject({ success: true });
      await expect(storage.tryReadLicense()).resolves.toBe(ENTERPRISE_LICENSE_KEY);
    });
  });
});
