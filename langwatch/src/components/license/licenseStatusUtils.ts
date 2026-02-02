import type { LicenseStatus } from "../../../ee/licensing/client";

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
 * Type guard that checks if a license is corrupted.
 * Corrupted licenses have hasLicense: true but cannot be read.
 */
export function isCorruptedLicense(
  status: Extract<LicenseStatus, { hasLicense: true }>
): boolean {
  return "corrupted" in status && status.corrupted === true;
}

/**
 * Determines if a license has expired based on its expiresAt date.
 * Returns true only when:
 * - License exists (hasLicense: true)
 * - License has metadata with expiresAt
 * - The expiresAt date is in the past
 *
 * Returns false for:
 * - No license
 * - Corrupted license (no metadata)
 * - Invalid license with future expiresAt (signature issues, not expired)
 */
export function isLicenseExpired(
  status: LicenseStatus | undefined
): boolean {
  if (!status) return false;
  if (!status.hasLicense) return false;

  // Check if we have metadata with expiresAt
  if (!hasLicenseMetadata(status)) return false;

  // Parse and compare the expiration date
  const expiresAt = new Date(status.expiresAt);
  if (isNaN(expiresAt.getTime())) return false;

  return expiresAt.getTime() < Date.now();
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
    timeZone: "UTC",
  });
}

/**
 * Formats a limit value for display.
 * Returns "Unlimited" for very large numbers (1M+) or special values like MAX_SAFE_INTEGER.
 */
export function formatLimitOrUnlimited(value: number): string {
  if (!Number.isFinite(value) || value >= 1_000_000) {
    return "Unlimited";
  }
  return value.toLocaleString();
}

/**
 * Formats a current/max pair for display.
 * Example: "5 / 10" or "5 / Unlimited"
 */
export function formatResourceUsage(current: number, max: number): string {
  return `${current.toLocaleString()} / ${formatLimitOrUnlimited(max)}`;
}

/**
 * Formats a file size in bytes to a human-readable string.
 * Returns bytes for < 1KB, KB for < 1MB, MB otherwise.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
