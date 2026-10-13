import type {
  LicenseData,
  SignedLicense,
  ValidationResult,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

export interface LicenseCryptography {
  parseLicenseKey(licenseKey: string): SignedLicense | null;
  verifySignature(signedLicense: SignedLicense, publicKey?: string): boolean;
  isExpired(expiresAt: string, now?: Instant): boolean;
  validateLicense(input: {
    licenseKey: string;
    publicKey?: string;
    now?: Instant;
  }): ValidationResult;
  signLicense(data: LicenseData, privateKey: string): SignedLicense;
  encodeLicenseKey(signedLicense: SignedLicense): string;
  generateLicenseId(): string;
  /** The identity an install mints for itself: a bare UUID (ADR-156). */
  generateInstanceId(): string;
  /**
   * The credential a connected install presents: `lwl_` plus the SHA-256 of the
   * canonical `{data, signature}`. Refuses text that is not a license.
   */
  getLicenseToken(licenseKey: string): string;
}
