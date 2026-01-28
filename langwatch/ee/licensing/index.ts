// Types
export type {
  LicenseData,
  LicensePlanLimits,
  LicenseStatus,
  RemoveLicenseResult,
  SignedLicense,
  StoreLicenseResult,
  ValidationResult,
} from "./types";

// PlanInfo type (client-safe, no server dependencies)
export type { PlanInfo } from "./planInfo";

// Constants
export { FREE_PLAN, LICENSE_ERRORS, PUBLIC_KEY, UNLIMITED_PLAN } from "./constants";
export type { LicenseError } from "./constants";

// Validation
export {
  parseLicenseKey,
  verifySignature,
  isExpired,
  validateLicense,
} from "./validation";

// Plan Mapping
export { mapToPlanInfo } from "./planMapping";

// License Handler
export { LicenseHandler } from "./licenseHandler";
export type { ITraceUsageService } from "./licenseHandler";

// Repository (re-exported for factory wiring)
export { LicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
export type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";

// Errors
export { OrganizationNotFoundError } from "./errors";

// Signing (for license generation)
export { signLicense, encodeLicenseKey, generateLicenseId } from "./signing";

// Plan Templates
export { PRO_TEMPLATE, ENTERPRISE_TEMPLATE, getPlanTemplate } from "./planTemplates";

// Server-side factory (createLicenseHandler) is in ./server.ts to avoid
// bundling Node.js-only dependencies (Elasticsearch, etc.) in client code.
// Import from 'ee/licensing/server' for server-side usage.
