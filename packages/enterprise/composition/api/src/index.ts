import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { SsoGate } from "@langwatch/enterprise-sso-contract";

export {
  EnterpriseGatewayTrpcComposition,
  type EnterpriseGatewayTrpcContext,
} from "./trpc/enterprise-gateway-trpc.composition.ts";
export {
  EnterpriseGovernanceTrpcComposition,
  type EnterpriseGovernanceTrpcContext,
} from "./trpc/enterprise-governance-trpc.composition.ts";
export {
  BACK_OFFICE_NO_PERMISSION,
  BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION,
  CURRENCY_NO_PERMISSION,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
  type EnterpriseTrpcContext,
} from "./trpc/enterprise-trpc.composition.ts";
export {
  AppGatewayDebitAdapter,
  AppGatewayGovernancePort,
  GatewayGovernancePort,
  type GovernanceBudgetResolutionInput,
} from "./governance/gateway-debit.adapter.ts";
export {
  AppGovernanceSignalsService,
  GovernanceSignalDeliveryPort,
  GovernanceSignalStoragePort,
} from "./governance/governance-signals.adapter.ts";
/**
 * How a personal key is minted: the Governance issuer port over the gateway's own virtual-key
 * writes.
 */
export {
  AppPersonalVirtualKeyIssuerPort,
  type GovernanceVirtualKeyPort,
} from "./governance/governance-products.adapter.ts";
/**
 * The governance REST family, reached through this composition rather than
 * directly: the API application may depend on the Enterprise API composition
 * and not on an Enterprise feature server.
 */
export { createGovernanceRestApp, GovernanceApp } from "@langwatch/enterprise-governance-server";

/**
 * The governance capability itself, and the three shapes an API-role process reads off it.
 */
export {
  GovernanceService,
  OrganizationSessionPolicyService,
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-server";

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
 * The Enterprise surfaces the API application mounts. `apps/api` may depend on this composition
 * and on nothing enterprise below it — `enterprise-direction` is what says so, and it was
 * reporting five direct dependencies on SCIM, webhook and governance packages.
 */
export { createScimTokensRestApp, ScimApp } from "@langwatch/enterprise-scim-server";
/**
 * The SCIM 2.0 provisioning family, the Auth0 intake beside it, and the two pieces an API-role
 * process composes the directory-sync service from.
 */
export {
  createScimProtocolRestApp,
  createScimWebhookRestApp,
  PostgresScimAdapter,
  ScimSyncLifecycleAdapter,
  ScimSyncLifecyclePort,
  type PostgresScimAdapterOptions,
  type ScimSyncLifecycleAdapterDeps,
  type ScimWebhookRestPorts,
} from "@langwatch/enterprise-scim-server";
export type { ScimService } from "@langwatch/enterprise-scim-contract";
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

/**
 * The audit trail every completed mutation is recorded on. Reached through this composition
 * for the same reason the governance family is: an API-role process may depend on the
 * Enterprise API composition and on no Enterprise feature server below it.
 */
export {
  AuditLogAdapter,
  type AuditLogRequestLike,
  type LegacyAuditLogInput,
} from "@langwatch/enterprise-audit-log-server";
