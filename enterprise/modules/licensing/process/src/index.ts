export { NodeLicenseCryptographyAdapter } from "./services/node-license-cryptography.service.ts";
export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";
export { licensingServer } from "./licensing.server.ts";
export { LicensingInfrastructureService } from "./services/licensing-infrastructure.service.ts";
/**
 * The two declared tRPC surfaces, and the one fact the enforcement half asks
 * the process to resolve. A mount binds the fact; nothing else may.
 */
export {
  callerEmailFact,
  licenseEnforcementTrpcTransport,
} from "./transport/license-enforcement.trpc.ts";
export { licenseTrpcTransport } from "./transport/licensing.trpc.ts";
/** The signed-license source an API-role process supplies to plan resolution. */
export {
  LicensingEntitlementSourceAdapter,
  type LicensePlanReader,
  type LicensingEntitlementSourceAdapterMode,
} from "./services/licensing-entitlement-source.service.ts";
export { MemoryOrganizationLicenseRepository } from "./repositories/memory/memory.organization-license.repository.ts";
export { PrismaOrganizationLicenseRepository } from "./repositories/prisma/prisma.organization-license.repository.ts";
export type {
  LicenseCryptography,
  LicenseLogger,
  LicenseRetention,
  LicenseRetentionRule,
  LicenseStorage,
  LicenseUsage,
  LicenseUsageCount,
  OrganizationLicense,
  OrganizationLicenseCandidate,
  OrganizationLicenseCandidates,
  OrganizationLicenseReads,
  StoredLicense,
} from "./app/licensing.members.ts";
export type { LicensePlanSourceOptions } from "./services/license-plan-source.service.ts";
export type {
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
export { ConnectCredentialService } from "./services/connect-credential.service.ts";
export { LicenseRegistryService } from "./services/license-registry.service.ts";
export { LicenseSyncService } from "./services/license-sync.service.ts";
export { MemoryIssuedLicenseRepository } from "./repositories/memory/memory.issued-license.repository.ts";
export { PrismaIssuedLicenseRepository } from "./repositories/prisma/prisma.issued-license.repository.ts";
export type {
  IssuedLicenseDraft,
  IssuedLicensePatch,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "./repositories/issued-license.repository.ts";
export type {
  ConnectManagedKeys,
  ContractBudgets,
  LicenseCustomers,
  LicenseDeliveryCipher,
  LicenseRegistryInfrastructure,
  LicenseSyncRateLimit,
  SeatChangeBilling,
} from "./app/licensing.members.ts";
export { isInstanceIdShape } from "./rules/license-token.rules.ts";
export { issuedLicenseView, statusOfIssuedLicense } from "./rules/issued-license.rules.ts";

/** The install end of Connect (ADR-156, section 9). */
export { connectTrpcTransport } from "./transport/connect.trpc.ts";
export { ConnectGatewayChannel } from "./channels/connect-gateway.channel.ts";
export { ConnectLicenseChannel } from "./channels/connect-license.channel.ts";
export { connectGatewayChannels } from "./channels/connect-gateway-channels.registry.ts";
export { connectLicenseChannels } from "./channels/connect-license-channels.registry.ts";
export type { ConnectDispatcher, ConnectFetch } from "./channels/http/http.connect-host.channel.ts";
export { ConnectInstallService } from "./services/connect-install.service.ts";
export { InstanceIdentityService } from "./services/instance-identity.service.ts";
export { LicenseRefreshService } from "./services/license-refresh.service.ts";
export { MemoryConnectOrganizationRepository } from "./repositories/memory/memory.connect-organization.repository.ts";
export { MemoryInstanceIdentityRepository } from "./repositories/memory/memory.instance-identity.repository.ts";
export { PrismaConnectOrganizationRepository } from "./repositories/prisma/prisma.connect-organization.repository.ts";
export { PrismaInstanceIdentityRepository } from "./repositories/prisma/prisma.instance-identity.repository.ts";
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
export { ContractBudgetService } from "./services/contract-budget.service.ts";
export { ConnectSpendBufferService } from "./services/connect-spend-buffer.service.ts";
export { HostedServicesService } from "./services/hosted-services.service.ts";
export { contractTermsOf } from "./rules/contract-terms.rules.ts";
export type {
  ContractBudget,
  ContractBudgetStore,
  HostedBudgetUsage,
  HostedJudge,
  HostedServicesInfrastructure,
  HostedSpendRecorder,
  HostedUsageReader,
} from "./app/licensing.members.ts";

/** Activation codes (ADR-156, section 5). */
export { ActivationCodeService } from "./services/activation-code.service.ts";
export { MemoryActivationCodeRepository } from "./repositories/memory/memory.activation-code.repository.ts";
export { PrismaActivationCodeRepository } from "./repositories/prisma/prisma.activation-code.repository.ts";
export type {
  ActivationClaim,
  ActivationCodeDraft,
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "./repositories/activation-code.repository.ts";
export type { ActivationRateLimit, LicenseMinter } from "./services/activation-code.service.ts";
export {
  activationCodeHash,
  activationCodeHint,
  isActivationCodeShape,
  mintActivationCode,
  normaliseActivationCode,
  statusOfActivationCode,
} from "./rules/activation-code.rules.ts";

/** The hosted Instant Evals judge a connected install judges with (ADR-156 §9). */
export {
  ConnectInstantEvalJudgeService,
  CONNECT_JUDGE_STATE_TTL_MS,
} from "./services/connect-instant-eval-judge.service.ts";
export type {
  ConnectInstantEvalJudge,
  ConnectInstantEvalJudgeCollaborators,
  ConnectProjectOrganizations,
} from "./services/connect-instant-eval-judge.service.ts";

/** The registry of self-hosted installs (ADR-156, section 10), on LangWatch Cloud only. */
export { MemorySelfHostedInstanceRepository } from "./repositories/memory/memory.self-hosted-instance.repository.ts";
export { PrismaSelfHostedInstanceRepository } from "./repositories/prisma/prisma.self-hosted-instance.repository.ts";
export type {
  CloudCustomer,
  CloudCustomerLookup,
  SelfHostedInstancesInfrastructure,
  SelfHostedLeadNotifications,
  SelfHostedLeadNurturing,
  SelfHostedLeadsInfrastructure,
  SelfHostedOrgTraits,
} from "./app/licensing.members.ts";
