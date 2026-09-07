import type {
  LicenseData,
  SignedLicense,
  ValidationResult,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

export abstract class LicenseCryptographyPort {
  abstract tryParseLicenseKey(licenseKey: string): SignedLicense | null;
  abstract verifySignature(signedLicense: SignedLicense, publicKey?: string): boolean;
  abstract isExpired(expiresAt: string, now?: Instant): boolean;
  abstract validateLicense(input: {
    licenseKey: string;
    publicKey?: string;
    now?: Instant;
  }): ValidationResult;
  abstract signLicense(data: LicenseData, privateKey: string): SignedLicense;
  abstract encodeLicenseKey(signedLicense: SignedLicense): string;
  abstract generateLicenseId(): string;
}
