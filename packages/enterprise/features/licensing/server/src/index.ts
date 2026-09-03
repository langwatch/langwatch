export { NodeLicenseCryptographyAdapter } from "./adapters/node.license-cryptography.adapter";
export {
  LicensingApp,
  type LicensingAppDependencies,
  type LicensingCaller,
  type MintLicenseInput,
  type SsoGateStatus,
} from "./app/licensing.app";
export { LicenseTrpcApi, type LicenseTrpcContext } from "./transport/api-trpc/license.api";
export {
  LicenseEnforcementTrpcApi,
  type LicenseEnforcementTrpcContext,
} from "./transport/api-trpc/license-enforcement.api";
export {
  LicensingEntitlementSource,
  type LicensePlanReader,
  type LicensingEntitlementSourceMode,
} from "./adapters/licensing.entitlement-source.adapter";
export { PostgresOrganizationLicenseAdapter } from "./adapters/postgres.organization-license.adapter";
export { LicenseCryptographyPort } from "./ports/license-cryptography.port";
export { OrganizationLicensePort } from "./ports/organization-license.port";
export { LicenseLoggerPort } from "./ports/license-logger.port";
export { LicenseRetentionPort, type LicenseRetentionRule } from "./ports/license-retention.port";
export { LicenseUsagePort, type LicenseUsageCount } from "./ports/license-usage.port";
export {
  LicenseStoragePort,
  type OrganizationLicenseCandidate,
  type StoredLicense,
} from "./ports/license-storage.port";
export { LicenseGenerationService } from "./services/license-generation.service";
export {
  LicensePlanSourceService,
  type LicensePlanSourceOptions,
} from "./services/license-plan-source.service";
export {
  LicenseService,
  LicenseServiceConfiguration,
  type LicenseRetentionConfiguration,
  type LicenseServiceConfigurationInput,
  type LicenseServiceOptions,
} from "./services/license.service";

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
} from "./services/plan-provider.service";
