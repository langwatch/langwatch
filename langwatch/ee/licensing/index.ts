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
export { FREE_PLAN, PUBLIC_KEY, UNLIMITED_PLAN } from "./constants";

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
