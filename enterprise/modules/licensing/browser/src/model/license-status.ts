import {
  detectLicenseInputForm,
  type LicenseStatus,
} from "@langwatch/enterprise-licensing-contract";
import { toEpochMs, readableDate } from "@langwatch/time";

/** License status with metadata fields (excludes corrupted/no-license states) */
export type LicenseStatusWithMetadata = Extract<LicenseStatus, { hasLicense: true; plan: string }>;

/**
 * Type guard that checks if a license status has metadata fields.
 * Returns true for valid and invalid (but readable) licenses.
 * Returns false for corrupted or missing licenses.
 */
export function hasLicenseMetadata(
  status: Extract<LicenseStatus, { hasLicense: true }>,
): status is LicenseStatusWithMetadata {
  return "plan" in status;
}

/**
 * Type guard that checks if a license is corrupted.
 * Corrupted licenses have hasLicense: true but cannot be read.
 */
export function isCorruptedLicense(status: Extract<LicenseStatus, { hasLicense: true }>): boolean {
  return "corrupted" in status && status.corrupted === true;
}

/**
 * Whether the license is one LangWatch signed whose term has simply ended.
 * The server answers this — only it checked the signature. Comparing
 * `expiresAt` here would call a forged license expired, which means nothing.
 */
export function isLicenseExpired(status: LicenseStatus | undefined): boolean {
  if (!status?.hasLicense) return false;

  return "expired" in status && status.expired;
}

/**
 * Whether the stored license binds the seat count it names. True for a
 * valid or expired license — a signed license keeps metering what it sold.
 * False otherwise: the deployment runs the uncapped open-source baseline.
 */
export function licenseMetersSeats(
  status: LicenseStatus | undefined,
): status is LicenseStatusWithMetadata {
  if (!status?.hasLicense) return false;

  return status.valid || isLicenseExpired(status);
}

/**
 * Formats an ISO date string for display.
 * Returns the original string if parsing fails.
 */
export function formatLicenseDate(isoDate: string): string {
  const epochMilliseconds = toEpochMs(isoDate);
  if (isNaN(epochMilliseconds)) {
    return isoDate;
  }
  return readableDate(epochMilliseconds).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Formats a limit value for display.
 * Returns "Unlimited" for non-finite values (Infinity, NaN) or large numbers (1M+).
 */
export function formatLimitOrUnlimited(value: number): string {
  if (!Number.isFinite(value) || value >= 1_000_000) {
    return "Unlimited";
  }
  return value.toLocaleString();
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

/** Whether the license names a hosted service, so a renewal can be collected now. */
export function isConnectedLicense(status: LicenseStatus | undefined): boolean {
  if (!status?.hasLicense) return false;
  return "connected" in status && status.connected === true;
}

/** Whether the license came from `LANGWATCH_LICENSE_KEY`, which the page cannot remove. */
export function isEnvironmentLicense(status: LicenseStatus | undefined): boolean {
  if (!status?.hasLicense) return false;
  return "source" in status && status.source === "environment";
}

/** A license file is a few hundred base64 characters; anything this large is another file. */
const MAX_LICENSE_FILE_BYTES = 64 * 1024;

/** A signed key is a few hundred characters of base64, nothing else. */
const LICENSE_KEY_TEXT = /^[A-Za-z0-9+/=_-]{64,}$/;

/** The license or activation code a file holds, judged by content whatever its name; else null. */
export function licenseTextOfFile({ text, size }: { text: string; size: number }): string | null {
  if (size > MAX_LICENSE_FILE_BYTES) return null;
  const trimmed = text.trim();
  if (detectLicenseInputForm(trimmed).form === "activation_code") return trimmed;
  const compact = trimmed.replace(/\s+/g, "");
  return LICENSE_KEY_TEXT.test(compact) && isSignedLicenseShape(compact) ? trimmed : null;
}

/** A signed key decodes to JSON holding the licence `data` and its `signature`. */
function isSignedLicenseShape(base64: string): boolean {
  try {
    const decoded: unknown = JSON.parse(atob(base64.replace(/-/g, "+").replace(/_/g, "/")));
    return (
      typeof decoded === "object" &&
      decoded !== null &&
      "signature" in decoded &&
      typeof decoded.signature === "string" &&
      "data" in decoded &&
      typeof decoded.data === "object" &&
      decoded.data !== null
    );
  } catch {
    return false;
  }
}
