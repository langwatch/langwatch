import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";

export type EnterpriseWebCompositionOptions = {
  initialLicenseStatus?: LicenseStatus;
};

/** Web-only Enterprise composition shell; it contains no React implementation. */
export class EnterpriseWebComposition {
  private constructor(
    readonly catalogue: EnterpriseCatalogue,
    readonly initialLicenseStatus: LicenseStatus | undefined,
  ) {}

  static create(
    options: EnterpriseWebCompositionOptions = {},
  ): EnterpriseWebComposition {
    return new EnterpriseWebComposition(
      EnterpriseCatalogue.create(),
      options.initialLicenseStatus,
    );
  }
}
