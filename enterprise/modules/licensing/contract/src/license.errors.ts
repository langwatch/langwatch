/**
 * Handled errors for licensing with stable codes the client renders copy from.
 * Each error is a named cause the caller can act on (pick org, paste key, renew).
 */

import { HandledError } from "@langwatch/handled-error";

import { LICENSE_ERRORS, type LicenseError } from "./license-constants.ts";

/**
 * The organization a license action names does not exist. Matched by
 * `code`, not `instanceof`, which breaks once a bundler loads two copies
 * of this module.
 */
export class OrganizationNotFoundError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "OrganizationNotFoundError";
  }
}

/**
 * The key isn't a license we can read — wrong format, or a bad signature.
 * One code for both: a customer cannot act differently on either, and
 * naming which one only helps a prober confirm the shape was right.
 */
export class LicenseKeyInvalidError extends HandledError {
  declare readonly code: "license_key_invalid";

  constructor() {
    super("license_key_invalid", "This license key is not valid", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "LicenseKeyInvalidError";
  }
}

/** The license verifies, but its expiry date has passed. */
export class LicenseExpiredError extends HandledError {
  declare readonly code: "license_expired";

  constructor() {
    super("license_expired", "This license has expired", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "LicenseExpiredError";
  }
}

/**
 * The signing key isn't a PEM private key — usually a public key, or a
 * fragment that lost its delimiters in a chat window. Separate from the
 * codes above: this is the *issuer's* key, not the customer's licence.
 */
export class LicenseSigningKeyNotPemError extends HandledError {
  declare readonly code: "license_signing_key_not_pem";

  constructor() {
    super(
      "license_signing_key_not_pem",
      "The provided license signing key is not a PEM private key",
      {
        httpStatus: 400,
        fault: "customer",
        tips: [
          "Provide the whole private key, including its BEGIN and END lines",
          "A public key cannot sign; provide the private half of the key pair",
        ],
      },
    );
    this.name = "LicenseSigningKeyNotPemError";
  }
}

/** The signing key is passphrase-protected, so signing cannot use it as-is. */
export class LicenseSigningKeyEncryptedError extends HandledError {
  declare readonly code: "license_signing_key_encrypted";

  constructor() {
    super(
      "license_signing_key_encrypted",
      "The provided license signing key is passphrase-protected",
      {
        httpStatus: 400,
        fault: "customer",
        tips: ["Provide an unencrypted private key; signing cannot use a passphrase-protected key"],
      },
    );
    this.name = "LicenseSigningKeyEncryptedError";
  }
}

/**
 * A well-formed PEM OpenSSL refused to sign with. OpenSSL's error is masked
 * (names internals/key material) so only this error's code reaches the client.
 */
export class LicenseSigningFailedError extends HandledError {
  declare readonly code: "license_signing_failed";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("license_signing_failed", "The provided license signing key could not be used to sign", {
      httpStatus: 400,
      fault: "customer",
      tips: ["Check that this is the license signing key and that it was copied in full"],
      ...options,
    });
    this.name = "LicenseSigningFailedError";
  }
}

/**
 * Converts ValidationResult failure verdicts to handled errors. The verdict is
 * a server discriminant (not copy), and unrecognized verdicts fail closed to
 * "invalid".
 */
export function licenseValidationError(verdict: LicenseError | string | undefined): HandledError {
  return verdict === LICENSE_ERRORS.EXPIRED
    ? new LicenseExpiredError()
    : new LicenseKeyInvalidError();
}
