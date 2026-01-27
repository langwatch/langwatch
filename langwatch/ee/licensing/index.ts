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

// Errors
export { OrganizationNotFoundError } from "./errors";

// Signing (for license generation)
export { signLicense, encodeLicenseKey, generateLicenseId } from "./signing";

// Plan Templates
export { PRO_TEMPLATE, ENTERPRISE_TEMPLATE, getPlanTemplate } from "./planTemplates";
