export { NodeLicenseCryptographyAdapter } from "./services/node-license-cryptography.service.ts";
export {
  LicensingApp,
  type LicensingInfrastructure,
  type LicensingRuntime,
} from "./app/licensing.app.ts";
export { licensingServer } from "./licensing.server.ts";
/**
 * The two declared tRPC surfaces, and the one fact the enforcement half asks
 * the process to resolve. A mount binds the fact; nothing else may.
 */
export {
  callerEmailFact,
  licenseEnforcementTrpcTransport,
} from "./transport/license-enforcement.trpc.ts";
export { licenseTrpcTransport } from "./transport/licensing.trpc.ts";
export {
  LicensingEntitlementSourceAdapter,
  type LicensePlanReader,
  type LicensingEntitlementSourceAdapterMode,
} from "./services/licensing-entitlement-source.service.ts";
export { PrismaOrganizationLicenseRepository } from "./repositories/prisma/prisma.organization-license.repository.ts";
export {
  type LicenseCryptography,
  type LicenseLogger,
  type LicenseRetention,
  type LicenseRetentionRule,
  type LicenseStorage,
  type LicenseUsage,
  type LicenseUsageCount,
  type OrganizationLicense,
  type OrganizationLicenseCandidate,
  type StoredLicense,
} from "./app/licensing.infrastructure.ts";
export { LicenseGenerationService } from "./services/license-generation.service.ts";
export {
  LicensePlanSourceService,
  type LicensePlanSourceOptions,
} from "./services/license-plan-source.service.ts";
export {
  LicenseService,
  LicenseServiceConfiguration,
  type LicenseRetentionConfiguration,
  type LicenseServiceConfigurationInput,
  type LicenseServiceOptions,
} from "./services/license.service.ts";

/**
 * The one point every resolved plan passes through, so a tier's entitlements
 * are applied once and hold everywhere. Was
 * `platform/app/src/server/app-layer/subscription/plan-provider.ts`.
 */
export {
  PlanProviderService,
  type PlanProvider,
  type PlanProviderUser,
  type PlanResolver,
} from "./services/plan-provider.service.ts";
