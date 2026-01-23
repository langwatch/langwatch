import type { LicenseStatus } from "../../../ee/licensing";

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
