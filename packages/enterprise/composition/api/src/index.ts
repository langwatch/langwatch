import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { ScimTokenCapability } from "@langwatch/enterprise-scim-contract";
import type { SsoGate } from "@langwatch/enterprise-sso-contract";

export type EnterpriseApiCompositionOptions = {
  licensing?: LicensingService;
  sso?: SsoGate;
  scimTokens?: ScimTokenCapability;
};

/** Explicit API-only Enterprise dependencies; registration remains app-owned. */
export class EnterpriseApiComposition {
  private constructor(
    readonly catalogue: EnterpriseCatalogue,
    readonly licensing: LicensingService | undefined,
    readonly sso: SsoGate | undefined,
    readonly scimTokens: ScimTokenCapability | undefined,
  ) {}

  static create(options: EnterpriseApiCompositionOptions = {}): EnterpriseApiComposition {
    return new EnterpriseApiComposition(
      EnterpriseCatalogue.create(),
      options.licensing,
      options.sso,
      options.scimTokens,
    );
  }
}
