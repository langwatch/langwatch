import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { ScimService } from "@langwatch/enterprise-scim-contract";

// The three tRPC compositions are not exported: each assembles feature tRPC
// transports that still name the deleted legacy builder. Their only consumers
// were the API process's own tRPC mounts, which are unmounted for the same
// reason.
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
  OrganizationSessionPolicyService,
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-server";

export type EnterpriseApiCompositionOptions = {
  licensing?: LicensingService;
  scim?: ScimService;
};

/** Explicit API-only Enterprise dependencies; registration remains app-owned. */
export class EnterpriseApiComposition {
  private constructor(
    readonly catalogue: EnterpriseCatalogue,
    readonly licensing: LicensingService | undefined,
    readonly scim: ScimService | undefined,
  ) {}

  static create(options: EnterpriseApiCompositionOptions = {}): EnterpriseApiComposition {
    return new EnterpriseApiComposition(
      EnterpriseCatalogue.create(),
      options.licensing,
      options.scim,
    );
  }
}

/**
 * The Enterprise surfaces the API application mounts. `apps/api` may depend on this composition
 * and on nothing enterprise below it — `enterprise-direction` is what says so, and it was
 * reporting five direct dependencies on SCIM, webhook and governance packages.
 */
export {
  scimServer,
  type ScimInfrastructure,
  type ScimManagementAuditPort,
  type ScimPlanProvider,
} from "@langwatch/enterprise-scim-server";
/**
 * The SCIM 2.0 provisioning family, the Auth0 intake beside it, and the two pieces an API-role
 * process composes the directory-sync service from. The four declared doors are inert until
 * the process mounts them on its own runtime.
 */
export {
  PostgresScimAdapter,
  scimProtocolErrorHandler,
  scimProtocolRest,
  scimTokenRest,
  scimTokenRestActor,
  scimTokenTrpcTransport,
  scimWebhookRest,
  ScimSyncLifecycleAdapter,
  ScimSyncLifecyclePort,
  type PostgresScimAdapterOptions,
  type ScimSyncLifecycleAdapterDeps,
} from "@langwatch/enterprise-scim-server";
export type { ScimApi, ScimService } from "@langwatch/enterprise-scim-contract";
export { eventMatches } from "@langwatch/webhook-contract";
export {
  createWebhookRestApp,
  webhookEndpointTrpcTransport,
  WebhookApp,
  WebhookEnvelopeService,
  type SendBatchPayload,
  type WebhookDeliveryService,
  type WebhookEndpointRuntime,
  type WebhookEndpointView,
  type WebhookEventsService,
} from "@langwatch/webhook-server";

/**
 * The audit trail every completed mutation is recorded on. Reached through this composition
 * for the same reason the governance family is: an API-role process may depend on the
 * Enterprise API composition and on no Enterprise feature server below it.
 */
export { auditLogServer } from "@langwatch/enterprise-audit-log-server";
export { EnterpriseApiAuditLog } from "./audit-log.composition.ts";

/**
 * Single sign-on: the licence gate a sign-in page asks which provider to offer,
 * and the operator's connection ledger behind `ssoConnections.*`. Reached
 * through this composition for the same reason the governance family is — an
 * API-role process may depend on it and on no Enterprise feature server below.
 */
export { EnterpriseApiSso, type EnterpriseApiSsoPeers } from "./sso.composition.ts";
export {
  ssoConnectionTrpcTransport,
  SsoConnectionLedgerPort,
  SsoGateLoggerPort,
  type SsoInfrastructure,
} from "@langwatch/enterprise-sso-server";
export {
  SsoApi,
  ssoConfigurationSchema,
  type SsoConfiguration,
} from "@langwatch/enterprise-sso-contract";
