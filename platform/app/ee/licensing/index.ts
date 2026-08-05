// Types

// Repository type (re-exported for factory wiring)
// NOTE: The class LicenseEnforcementRepository is NOT exported here to avoid
// bundling server-side code (Prisma) into client components. Import directly
// from "~/server/license-enforcement/license-enforcement.repository" for server usage.
export type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
export type { LicenseError } from "./constants";

// Constants
export {
  FREE_PLAN,
  LICENSE_ERRORS,
  PUBLIC_KEY,
  UNLIMITED_PLAN,
} from "./constants";
// Errors
export { OrganizationNotFoundError } from "./errors";
export type { ITraceUsageService } from "./licenseHandler";
// License Handler
export { LicenseHandler } from "./licenseHandler";
// PlanInfo type (client-safe, no server dependencies)
export type { PlanInfo } from "./planInfo";
// Plan Mapping
export { mapToPlanInfo } from "./planMapping";
// Plan Templates
export {
  ENTERPRISE_TEMPLATE,
  getPlanTemplate,
  PRO_TEMPLATE,
} from "./planTemplates";
export type {
  LicenseData,
  LicensePlanLimits,
  LicenseStatus,
  RemoveLicenseResult,
  SignedLicense,
  StoreLicenseResult,
  ValidationResult,
} from "./types";
// Validation
export {
  isExpired,
  parseLicenseKey,
  validateLicense,
  verifySignature,
} from "./validation";

// NOTE: Signing functions (signLicense, encodeLicenseKey, generateLicenseId) are NOT
// exported here to avoid bundling Node.js crypto in client bundles. Import directly
// from 'ee/licensing/signing' for server-side usage.

// NOTE: Server-side factory (createLicenseHandler) is in ./server.ts to avoid
// bundling Node.js-only dependencies in client code.
// Import from 'ee/licensing/server' for server-side usage.
