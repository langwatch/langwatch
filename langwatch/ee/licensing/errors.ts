/**
 * Handled errors for the licensing domain.
 *
 * Each one is a named cause the caller can act on — pick a different
 * organization, paste a valid key, renew — so each carries a stable `code`
 * and the client renders copy keyed off it
 * (`src/features/errors/logic/presentation.ts`). Nothing here needs a
 * try/catch at the router: the shared handled-error middleware maps
 * `httpStatus` and keeps the error as the `cause`.
 */

import { HandledError } from "@langwatch/handled-error";
import { LICENSE_ERRORS, type LicenseError } from "./constants";

/**
 * The organization a license action names does not exist.
 *
 * Previously a bare `Error` matched by `instanceof` in three router handlers,
 * each re-wrapping it as a `TRPCError`. `instanceof` is same-process only and
 * breaks the moment a bundler loads two copies of this module, so the code is
 * the discriminant now and those handlers are gone.
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
 * The key isn't a license we can read — wrong format, or a signature that
 * doesn't verify.
 *
 * Both collapse to one code deliberately: a customer cannot act differently on
 * "malformed" than on "not signed by us", and telling them which one it is
 * only tells whoever is probing that they got the shape right.
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
 * Turns a `ValidationResult`'s failure verdict into the handled error for it.
 *
 * `validateLicense` reports its verdict as one of the `LICENSE_ERRORS`
 * literals rather than throwing, and that literal is a *server* discriminant,
 * not copy — it used to be string-matched on the client to pick a sentence,
 * which is exactly the coupling the code-keyed presentation registry removes.
 *
 * An unrecognised verdict maps to "invalid", never to success: a licence check
 * must fail closed.
 */
export function licenseValidationError(
  verdict: LicenseError | string | undefined,
): HandledError {
  return verdict === LICENSE_ERRORS.EXPIRED
    ? new LicenseExpiredError()
    : new LicenseKeyInvalidError();
}
