import type { LicenseStatus } from "../../../ee/licensing";

/** License status with metadata fields (excludes corrupted/no-license states) */
export type LicenseStatusWithMetadata = Extract<
  LicenseStatus,
  { hasLicense: true; plan: string }
>;

/**
 * Type guard that checks if a license status has metadata fields.
 * Returns true for valid and invalid (but readable) licenses.
 * Returns false for corrupted or missing licenses.
 */
export function hasLicenseMetadata(
  status: Extract<LicenseStatus, { hasLicense: true }>
): status is LicenseStatusWithMetadata {
  return "plan" in status;
}

/**
 * Determines if a license has expired based on its status.
 * A license is considered expired when it exists but is no longer valid.
 */
export function deriveIsExpired(
  status: LicenseStatus | undefined
): boolean {
  if (!status) return false;
  return status.hasLicense && !status.valid;
}

/**
 * Normalizes a license key for activation.
 * Trims whitespace and returns null for empty/whitespace-only keys.
 */
export function normalizeKeyForActivation(key: string): string | null {
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Formats an ISO date string for display.
 * Returns the original string if parsing fails.
 */
export function formatLicenseDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
