import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { SsoGate } from "@langwatch/enterprise-sso-contract";

export {
  EnterpriseGatewayTrpcComposition,
  type EnterpriseGatewayTrpcContext,
} from "./trpc/enterprise-gateway-trpc.composition";
export {
  EnterpriseGovernanceTrpcComposition,
  type EnterpriseGovernanceTrpcContext,
} from "./trpc/enterprise-governance-trpc.composition";
export {
  BACK_OFFICE_NO_PERMISSION,
  BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION,
  CURRENCY_NO_PERMISSION,
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
/**
 * The governance REST family, reached through this composition rather than
 * directly: the API application may depend on the Enterprise API composition
 * and not on an Enterprise feature server.
 */
export { createGovernanceRestApp, GovernanceApp } from "@langwatch/enterprise-governance-server";

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

/**
 * The Enterprise surfaces the API application mounts.
 *
 * `apps/api` may depend on this composition and on nothing enterprise below it
 * — `enterprise-direction` is what says so, and it was reporting five direct
 * dependencies on SCIM, webhook and governance packages. Re-exported here
 * rather than repaired at each call site because being that seam is what this
 * package is FOR: an API-role Enterprise composition, named as such, and the
 * only enterprise thing an api-role application is allowed to see.
 */
export { createScimTokensRestApp, ScimApp } from "@langwatch/enterprise-scim-server";
export { eventMatches } from "@langwatch/enterprise-webhook-contract";
export {
  createWebhookRestApp,
  WebhookApp,
  WebhookEnvelopeService,
  type SendBatchPayload,
  type WebhookDeliveryService,
  type WebhookEndpointRuntime,
  type WebhookEndpointView,
  type WebhookEventsService,
} from "@langwatch/enterprise-webhook-server";
