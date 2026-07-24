import crypto from "crypto";
import type { LicenseData, SignedLicense } from "./types";

/**
 * Signs license data with an RSA private key using SHA256.
 *
 * @param data - The license data to sign
 * @param privateKey - RSA private key in PEM format
 * @returns SignedLicense with data and base64-encoded signature
 */
export function signLicense(data: LicenseData, privateKey: string): SignedLicense {
  const dataString = JSON.stringify(data);
  const sign = crypto.createSign("SHA256");
  sign.update(dataString);
  sign.end();

  const signature = sign.sign(privateKey, "base64");

  return {
    data,
    signature,
  };
}

/**
 * Encodes a signed license as a base64 string for distribution.
 *
 * @param signedLicense - The signed license to encode
 * @returns Base64-encoded license key string
 */
export function encodeLicenseKey(signedLicense: SignedLicense): string {
  const json = JSON.stringify(signedLicense);
  return Buffer.from(json, "utf-8").toString("base64");
}

/**
 * Generates a unique license ID.
 *
 * @returns A unique license ID prefixed with "lic-"
 */
export function generateLicenseId(): string {
  return `lic-${crypto.randomUUID()}`;
}
