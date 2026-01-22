import crypto from "crypto";
import type { PlanInfo } from "~/server/subscriptionHandler";
import { FREE_PLAN, PUBLIC_KEY } from "./constants";
import { mapToPlanInfo } from "./planMapping";
import type { SignedLicense, ValidationResult } from "./types";

/**
 * Parses a base64-encoded license key into a SignedLicense object.
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

    // Validate structure
    if (!isSignedLicense(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Type guard to check if an object is a valid SignedLicense.
 */
function isSignedLicense(obj: unknown): obj is SignedLicense {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const license = obj as Record<string, unknown>;

  if (typeof license.signature !== "string") {
    return false;
  }

  if (typeof license.data !== "object" || license.data === null) {
    return false;
  }

  const data = license.data as Record<string, unknown>;

  return (
    typeof data.licenseId === "string" &&
    typeof data.version === "number" &&
    typeof data.organizationName === "string" &&
    typeof data.email === "string" &&
    typeof data.issuedAt === "string" &&
    typeof data.expiresAt === "string" &&
    typeof data.plan === "object" &&
    data.plan !== null
  );
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

/**
 * Gets plan info from a license key, returning FREE_PLAN for invalid/expired licenses.
 *
 * @param licenseKey - Base64-encoded license string
 * @param publicKey - RSA public key (defaults to production key)
 * @returns PlanInfo from license, or FREE_PLAN if invalid/expired
 */
export function getPlanFromLicense(
  licenseKey: string,
  publicKey: string = PUBLIC_KEY,
): PlanInfo {
  const result = validateLicense(licenseKey, publicKey);
  if (result.valid) {
    return result.planInfo;
  }
  return FREE_PLAN;
}
