import type { Instant } from "@langwatch/time";

import type { OrganizationRepository } from "../repositories/organization.repository.ts";
import { fingerprintOfLicenseKey } from "../rules/organization-license.rules.ts";

/** Licensing's facts applied to the organization row: switched-off services and the stored key. */
export class OrganizationLicensingFactsService {
  static create(deps: { repository: OrganizationRepository }): OrganizationLicensingFactsService {
    return new OrganizationLicensingFactsService(deps.repository);
  }

  private constructor(private readonly repository: OrganizationRepository) {}

  /** Licensing's switch, from its fact: the switched-off list gains or loses one name. */
  async switchConnectService({
    organizationId,
    service,
    enabled,
  }: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<void> {
    const current = await this.repository.findConnectServicesDisabled(organizationId);
    const servicesDisabled = enabled
      ? current.filter((name) => name !== service)
      : [...new Set([...current, service])];
    await this.repository.updateConnectServicesDisabled({ organizationId, servicesDisabled });
  }

  /** Writes licensing's key only while its row still holds the one the fact names (C3-KEY-HASH). */
  async setLicense({
    organizationId,
    licenseKeyFingerprint,
    expiresAt,
    validatedAt,
  }: {
    organizationId: string;
    licenseKeyFingerprint: string;
    expiresAt: Instant;
    validatedAt: Instant | null;
  }): Promise<void> {
    const keys = await this.repository.findLicensingLicenseKeys({ organizationId });
    const licenseKey = keys.find((key) => fingerprintOfLicenseKey(key) === licenseKeyFingerprint);
    // A newer store or a clear replaced it; that write's own fact follows and applies it.
    if (licenseKey === undefined) return;
    await this.repository.setLicense({ organizationId, licenseKey, expiresAt, validatedAt });
  }
}
