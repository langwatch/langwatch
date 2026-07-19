/**
 * Client-safe exports for the licensing module.
 *
 * This barrel re-exports only types and constants that do NOT depend on
 * Node.js built-ins (crypto, Buffer, etc.). Use this for client-side
 * imports. For server-side code, import from the main barrel or specific files.
 */

// Types (always client-safe)
export type {
  LicenseData,
  LicensePlanLimits,
  LicenseStatus,
  SignedLicense,
  ValidationResult,
} from "./types";

// PlanInfo type (client-safe, no server dependencies)
export type { PlanInfo } from "./planInfo";

// Constants (plain objects, no Node.js dependencies)
export { FREE_PLAN, LICENSE_ERRORS, UNLIMITED_PLAN } from "./constants";
export type { LicenseError } from "./constants";

// Plan Templates (plain objects, client-safe)
export { PRO_TEMPLATE, ENTERPRISE_TEMPLATE, getPlanTemplate } from "./planTemplates";

// Errors (plain JS classes)
export { OrganizationNotFoundError } from "./errors";
