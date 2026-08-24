import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { AdminClient } from "@langwatch/enterprise-admin-web";
import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";

export type EnterpriseWebCompositionOptions = {
  initialLicenseStatus?: LicenseStatus;
  admin?: AdminClient;
};

/** Web-only Enterprise composition shell; it contains no React implementation. */
export class EnterpriseWebComposition {
  private constructor(
    readonly catalogue: EnterpriseCatalogue,
    readonly initialLicenseStatus: LicenseStatus | undefined,
    readonly admin: AdminClient | undefined,
  ) {}

  static create(
    options: EnterpriseWebCompositionOptions = {},
  ): EnterpriseWebComposition {
    return new EnterpriseWebComposition(
      EnterpriseCatalogue.create(),
      options.initialLicenseStatus,
      options.admin,
    );
  }
}
