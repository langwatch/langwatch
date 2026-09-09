export { NodeLicenseCryptographyAdapter } from "./adapters/node.license-cryptography.adapter.ts";
export {
  LicensingApp,
  type LicensingInfrastructure,
  type LicensingRuntime,
  type LicensingCaller,
  type MintLicenseInput,
  type SsoGateStatus,
} from "./app/licensing.app.ts";
// The two tRPC transports are not exported: they still name the deleted legacy
// builder.
export {
  LicensingEntitlementSourceAdapter,
  type LicensePlanReader,
  type LicensingEntitlementSourceAdapterMode,
} from "./adapters/licensing.entitlement-source.adapter.ts";
export { PostgresOrganizationLicenseAdapter } from "./adapters/postgres.organization-license.adapter.ts";
export { LicenseCryptographyPort } from "./ports/license-cryptography.port.ts";
export { OrganizationLicensePort } from "./ports/organization-license.port.ts";
export { LicenseLoggerPort } from "./ports/license-logger.port.ts";
export { LicenseRetentionPort, type LicenseRetentionRule } from "./ports/license-retention.port.ts";
export { LicenseUsagePort, type LicenseUsageCount } from "./ports/license-usage.port.ts";
export {
  LicenseStoragePort,
  type OrganizationLicenseCandidate,
  type StoredLicense,
} from "./ports/license-storage.port.ts";
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
