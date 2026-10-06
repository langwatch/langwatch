export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";
export { licensingProcessModule } from "./licensing.module.ts";
/** The declared licence tRPC surface. */
export { licenseTrpcTransport } from "./transport/licensing.trpc.ts";
/** The signed-license source an API-role process supplies to plan resolution. */
export type {
  LicensePlanReader,
  LicensingEntitlementSourceMode,
} from "./services/licensing-entitlement-source.service.ts";
export type {
  OrganizationLicense,
  OrganizationLicenseCandidate,
  OrganizationLicenseCandidates,
  OrganizationLicenseReads,
  StoredLicense,
} from "./repositories/organization-license.repository.ts";
export type { LicensePlanSourceOptions } from "./services/license-plan-source.service.ts";
export type {
  LicenseLogger,
  LicenseRetention,
  LicenseRetentionRule,
  LicenseStorage,
  LicenseUsage,
  LicenseUsageCount,
  LicenseRetentionConfiguration,
  LicenseServiceConfigurationInput,
  LicenseServiceOptions,
} from "./services/license.service.ts";

/**
 * The one point every resolved plan passes through, so a tier's entitlements
 * are applied once and hold everywhere. Was
 * `platform/app/src/server/app-layer/subscription/plan-provider.ts`.
 */
export type {
  PlanProvider,
  PlanProviderUser,
  PlanResolver,
} from "./services/plan-provider.service.ts";

/**
 * The license registry (ADR-156): the record of every license LangWatch issued,
 * the credential a connected install presents, and the daily sync. Only a
 * LangWatch Cloud process composes the infrastructure; elsewhere it refuses.
 */
export type {
  IssuedLicenseDraft,
  IssuedLicensePatch,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "./repositories/issued-license.repository.ts";
export type { ContractBudgets } from "./services/contract-budget.service.ts";
export type { ConnectManagedKeys, LicenseCustomers } from "./services/license-registry.service.ts";
export type { LicenseSyncRateLimit } from "./services/license-sync.service.ts";

/** The install end of Connect (ADR-156, section 9). */
export { connectTrpcTransport } from "./transport/connect.trpc.ts";
export { ConnectGatewayChannel } from "./channels/connect-gateway.channel.ts";
export { ConnectLicenseChannel } from "./channels/connect-license.channel.ts";
export { connectGatewayChannels } from "./channels/connect-gateway-channels.registry.ts";
export { connectLicenseChannels } from "./channels/connect-license-channels.registry.ts";
export type { ConnectDispatcher, ConnectFetch } from "./channels/http/http.connect-host.channel.ts";
export type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
} from "./repositories/connect-organization.repository.ts";
export type {
  InstanceIdentityRecord,
  InstanceIdentityRepository,
} from "./repositories/instance-identity.repository.ts";

/** The hosted end of Connect (ADR-156, section 5), on LangWatch Cloud only. */
export { connectHostRest } from "./transport/connect-host.rest.ts";
export { connectHostedRest } from "./transport/connect-hosted.rest.ts";
export type { ContractBudget, ContractBudgetStore } from "./services/contract-budget.service.ts";
export type { HostedSpendRecorder } from "./services/connect-spend-buffer.service.ts";
export type { HostedJudge } from "./services/hosted-services.service.ts";
export type {
  HostedBudgetUsage,
  HostedUsageReader,
} from "./services/hosted-usage-reader.service.ts";

/** Activation codes (ADR-156, section 5). */
export type {
  ActivationClaim,
  ActivationCodeDraft,
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "./repositories/activation-code.repository.ts";
export type { ActivationRateLimit, LicenseMinter } from "./services/activation-code.service.ts";

/** The registry of self-hosted installs (ADR-156, section 10), on LangWatch Cloud only. */
export type {
  CloudCustomer,
  CloudCustomerLookup,
  SelfHostedLeadNotifications,
  SelfHostedLeadNurturing,
  SelfHostedLeadsInfrastructure,
  SelfHostedOrgTraits,
} from "./services/self-hosted-crm.service.ts";
