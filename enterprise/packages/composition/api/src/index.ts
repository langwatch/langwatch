import { EnterpriseCatalogue } from "@langwatch/enterprise";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { ScimService } from "@langwatch/enterprise-scim-contract";

// The three tRPC compositions are not exported: each assembles feature tRPC
// transports that still name the deleted legacy builder. Their only consumers
// were the API process's own tRPC mounts, which are unmounted for the same
// reason.
export {
  AppGatewayDebitAdapter,
  AppGatewayGovernance,
  GatewayGovernance,
  type GovernanceBudgetResolutionInput,
} from "./governance/gateway-debit.adapter.ts";
export {
  AppGovernanceSignalsService,
  GovernanceSignalDelivery,
  GovernanceSignalStorage,
} from "./governance/governance-signals.adapter.ts";
/**
 * The governance capability itself, and the three shapes an API-role process reads off it.
 */
export {
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
export { scimServer } from "@langwatch/enterprise-scim-server";
/**
 * The SCIM 2.0 provisioning family, the Auth0 intake beside it, and the lifecycle an API-role
 * process composes the directory sync from. The four declared doors are inert until the
 * process mounts them on its own runtime.
 */
export {
  createScimSyncLifecycle,
  scimProtocolErrorHandler,
  scimProtocolRest,
  scimTokenRest,
  scimTokenRestActor,
  scimTokenTrpcTransport,
  scimWebhookRest,
  type ScimSyncLifecycle,
  type ScimSyncLifecycleAdapterDeps,
} from "@langwatch/enterprise-scim-server";
// Not re-exported from the scim-server package barrel; the type still lives
// where it always did.
export type { PostgresScimAdapterOptions } from "../../../../modules/scim/server/src/services/postgres-scim.service.ts";
export type { ScimApi, ScimService } from "@langwatch/enterprise-scim-contract";
export { eventMatches } from "@langwatch/webhook-contract";
export {
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

/** Enterprise API composition's single sign-on surfaces. */
export { EnterpriseApiSso, type EnterpriseApiSsoPeers } from "./sso.composition.ts";
export {
  ssoConnectionTrpcTransport,
  type SsoConnectionLedger,
  type SsoGateLogger,
  type SsoInfrastructure,
} from "@langwatch/enterprise-sso-server";
export {
  SsoApi,
  ssoConfigurationSchema,
  type SsoConfiguration,
} from "@langwatch/enterprise-sso-contract";

/** The signed-license source used by Enterprise plan resolution. */
export {
  createActivatedLicenseSource,
  type ActivatedLicenseSourceOptions,
} from "@langwatch/enterprise-licensing-server";
