import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";

import { type GeneratedLicense, LicenseGenerator } from "./license-purchase.service.ts";

/** The tier main minted every Stripe licence purchase on. */
const PURCHASED_LICENSE_PLAN = "GROWTH";

/**
 * Main's `generateLicenseKey` for a purchase, through licensing's own signer. The signing
 * key is resolved at the boot seam and held here; the purchase flow never sees it.
 */
export class LicensingLicenseGeneratorService extends LicenseGenerator {
  private constructor(
    private readonly licensing: Pick<LicensingApi, "generateLicenseKey">,
    private readonly privateKey: string,
  ) {
    super();
  }

  static create(options: {
    licensing: Pick<LicensingApi, "generateLicenseKey">;
    privateKey: string;
  }): LicensingLicenseGeneratorService {
    return new LicensingLicenseGeneratorService(options.licensing, options.privateKey);
  }

  async generate(input: {
    organizationName: string;
    email: string;
    maxMembers: number;
  }): Promise<GeneratedLicense> {
    const { licenseKey, licenseData } = await this.licensing.generateLicenseKey({
      ...input,
      planType: PURCHASED_LICENSE_PLAN,
      privateKey: this.privateKey,
    });
    return {
      licenseKey,
      licenseData: {
        licenseId: licenseData.licenseId,
        plan: { type: licenseData.plan.type },
        expiresAt: licenseData.expiresAt,
        organizationName: licenseData.organizationName,
      },
    };
  }
}
