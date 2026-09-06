/**
 * Client-safe exports for the licensing module.
 *
 * This barrel re-exports only types and constants that do NOT depend on
 * Node.js built-ins (crypto, Buffer, etc.). Use this for client-side
 * imports. For server-side code, import from the main barrel or specific files.
 */

export type { LicenseError } from "./constants";
// Constants (plain objects, no Node.js dependencies)
export { FREE_PLAN, LICENSE_ERRORS, UNLIMITED_PLAN } from "./constants";
// Errors (plain JS classes)
export { OrganizationNotFoundError } from "./errors";
// PlanInfo type (client-safe, no server dependencies)
export type { PlanInfo } from "./planInfo";

// Plan Templates (plain objects, client-safe)
export {
  ENTERPRISE_TEMPLATE,
  getPlanTemplate,
  PRO_TEMPLATE,
} from "./planTemplates";
// Types (always client-safe)
export type {
  LicenseData,
  LicensePlanLimits,
  LicenseStatus,
  SignedLicense,
  ValidationResult,
} from "./types";
