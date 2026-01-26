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
