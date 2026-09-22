export { NodeLicenseCryptographyAdapter } from "./services/node-license-cryptography.service.ts";
export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";
export { licensingServer } from "./licensing.server.ts";
export {
  createOrganizationLicenses,
  createUnavailableLicensingInfrastructure,
} from "./services/licensing-infrastructure.service.ts";
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
