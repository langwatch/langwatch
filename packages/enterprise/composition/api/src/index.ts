import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { SsoGate } from "@langwatch/enterprise-sso-contract";

export {
  BACK_OFFICE_NO_PERMISSION,
  BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
  type EnterpriseTrpcContext,
} from "./trpc/enterprise-trpc.composition";
export {
  AppGatewayDebitAdapter,
  AppGatewayGovernancePort,
  GatewayGovernancePort,
  type GovernanceBudgetResolutionInput,
} from "./governance/gateway-debit.adapter";
export {
  AppGovernanceSignalsService,
  GovernanceSignalDeliveryPort,
  GovernanceSignalStoragePort,
} from "./governance/governance-signals.adapter";

export type EnterpriseApiCompositionOptions = {
  licensing?: LicensingService;
  sso?: SsoGate;
  scim?: ScimService;
};

/** Explicit API-only Enterprise dependencies; registration remains app-owned. */
export class EnterpriseApiComposition {
  private constructor(
    readonly catalogue: EnterpriseCatalogue,
    readonly licensing: LicensingService | undefined,
    readonly sso: SsoGate | undefined,
    readonly scim: ScimService | undefined,
  ) {}

  static create(options: EnterpriseApiCompositionOptions = {}): EnterpriseApiComposition {
    return new EnterpriseApiComposition(
      EnterpriseCatalogue.create(),
      options.licensing,
      options.sso,
      options.scim,
    );
  }
}
