import crypto from "crypto";
import { PUBLIC_KEY } from "./constants";
import { mapToPlanInfo } from "./planMapping";
import { SignedLicenseSchema } from "./types";
import type { SignedLicense, ValidationResult } from "./types";

/**
 * Parses a base64-encoded license key into a SignedLicense object.
 * Uses Zod schema validation for type-safe parsing.
 *
 * @param licenseKey - Base64-encoded license string
 * @returns SignedLicense if valid, null if parsing fails
 */
export function parseLicenseKey(licenseKey: string): SignedLicense | null {
  if (!licenseKey || licenseKey.trim() === "") {
    return null;
  }

  try {
    const decoded = Buffer.from(licenseKey, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as unknown;
    const result = SignedLicenseSchema.safeParse(parsed);

    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Verifies the RSA-SHA256 signature of a license.
 *
 * @param signedLicense - The license with data and signature
 * @param publicKey - RSA public key in PEM format (defaults to production key)
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(
  signedLicense: SignedLicense,
  publicKey: string = PUBLIC_KEY,
): boolean {
  if (!signedLicense.signature || signedLicense.signature.trim() === "") {
    return false;
  }

  try {
    const dataString = JSON.stringify(signedLicense.data);
    const verify = crypto.createVerify("SHA256");
    verify.update(dataString);
    verify.end();

    return verify.verify(publicKey, signedLicense.signature, "base64");
  } catch {
    return false;
  }
}

/**
 * Checks if a license has expired.
 *
 * @param expiresAt - ISO 8601 date string
 * @param now - Current date (for testing)
 * @returns true if the license is expired
 */
export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  const expirationDate = new Date(expiresAt);
  return now >= expirationDate;
}

/**
 * Validates a license key completely: parsing, signature, and expiration.
 *
 * @param licenseKey - Base64-encoded license string
 * @param publicKey - RSA public key (defaults to production key)
 * @returns ValidationResult indicating success or failure with error
 */
export function validateLicense(
  licenseKey: string,
  publicKey: string = PUBLIC_KEY,
): ValidationResult {
  // Step 1: Parse
  const signedLicense = parseLicenseKey(licenseKey);
  if (!signedLicense) {
    return { valid: false, error: "Invalid license format" };
  }

  // Step 2: Verify signature
  if (!verifySignature(signedLicense, publicKey)) {
    return { valid: false, error: "Invalid signature" };
  }

  // Step 3: Check expiration
  if (isExpired(signedLicense.data.expiresAt)) {
    return { valid: false, error: "License expired" };
  }

  // Success!
  return {
    valid: true,
    licenseData: signedLicense.data,
    planInfo: mapToPlanInfo(signedLicense.data),
  };
}

