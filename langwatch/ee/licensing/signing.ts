import crypto from "crypto";

import {
  LicenseSigningFailedError,
  LicenseSigningKeyEncryptedError,
  LicenseSigningKeyNotPemError,
} from "./errors";
import { isEncryptedPemKey, looksLikePemKey, normalizePemKey } from "./pem";
import type { LicenseData, SignedLicense } from "./types";

/**
 * Signs license data with an RSA private key using SHA256.
 *
 * The key is normalized first, so how the operator pasted it — indented, with
 * stray leading or trailing whitespace, on one line, or `\n`-escaped out of a
 * `.env` — does not decide whether signing works. This is the single choke
 * point every caller (tRPC router, generation service, Stripe webhook, CLI
 * script) funnels through.
 *
 * @param data - The license data to sign
 * @param privateKey - RSA private key in PEM format
 * @returns SignedLicense with data and base64-encoded signature
 * @throws LicenseSigningKeyNotPemError | LicenseSigningKeyEncryptedError |
 *   LicenseSigningFailedError — handled errors, so the transport layers map
 *   them to a 400 with remediation copy without bespoke wiring.
 */
export function signLicense(
  data: LicenseData,
  privateKey: string,
): SignedLicense {
  const normalizedKey = normalizePemKey(privateKey);

  if (!looksLikePemKey(normalizedKey)) {
    throw new LicenseSigningKeyNotPemError();
  }

  if (isEncryptedPemKey(normalizedKey)) {
    throw new LicenseSigningKeyEncryptedError();
  }

  const dataString = JSON.stringify(data);
  const sign = crypto.createSign("SHA256");
  sign.update(dataString);
  sign.end();

  let signature: string;
  try {
    signature = sign.sign(normalizedKey, "base64");
  } catch (error) {
    // OpenSSL's own error names internals and can quote key material, so it is
    // kept as a masked `reason` for the logs rather than forwarded to a client.
    throw new LicenseSigningFailedError({
      reasons: error instanceof Error ? [error] : [],
    });
  }

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
