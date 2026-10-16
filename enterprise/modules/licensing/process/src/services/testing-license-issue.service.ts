/**
 * Issues a testing licence to a caller the testing-licence token door let in (ADR-180 section 2).
 * The door already asked the person the token acts as for ops permissions on this call.
 */

import {
  TestingLicenseLifetimeTooLongError,
  type IssuedTestingLicense,
  type TestingLicenseIssuer,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import { testingLicenseExpiry } from "../rules/testing-license-issue.rules.ts";
import type { LicenseRegistryService } from "./license-registry.service.ts";
import type { TestingLicenseTokenService } from "./testing-license-token.service.ts";

export class TestingLicenseIssueService {
  static create(options: {
    registry: Pick<LicenseRegistryService, "issueTesting">;
    tokens: Pick<TestingLicenseTokenService, "recordUse">;
    now: () => Instant;
  }): TestingLicenseIssueService {
    return new TestingLicenseIssueService(options.registry, options.tokens, options.now);
  }

  private constructor(
    private readonly registry: Pick<LicenseRegistryService, "issueTesting">,
    private readonly tokens: Pick<TestingLicenseTokenService, "recordUse">,
    private readonly now: () => Instant,
  ) {}

  /** Signed and recorded before the token's use is stamped, so a failed issue stamps nothing. */
  async issue({
    instanceId,
    organizationId,
    lifetimeHours,
    issuer,
  }: {
    instanceId: string;
    organizationId: string;
    lifetimeHours?: number;
    issuer: TestingLicenseIssuer;
  }): Promise<IssuedTestingLicense> {
    const expiry = testingLicenseExpiry({ now: this.now(), lifetimeHours });
    if (!expiry.allowed) throw new TestingLicenseLifetimeTooLongError({ maxDays: expiry.maxDays });

    const signed = await this.registry.issueTesting({
      instanceId,
      organizationId,
      expiresAt: expiry.expiresAt,
      // The registry names the person the token acts as, for a service token its maker.
      issuedById: issuer.userId,
    });
    await this.tokens.recordUse({ tokenId: issuer.tokenId });

    return {
      licenseKey: signed.licenseKey,
      issuedLicenseId: signed.license.id,
      expiresAt: signed.license.expiresAt,
    };
  }
}
