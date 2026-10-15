// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Refusals of a testing licence and of the tokens that ask for one (ADR-180 section 2).
 * A token refusal says only that the token cannot be used, never whose it was.
 */

import { HandledError } from "@langwatch/handled-error";

/** A testing licence lasts at most 30 days. */
export class TestingLicenseLifetimeTooLongError extends HandledError {
  declare readonly code: "testing_license_lifetime_too_long";

  constructor({ maxDays }: { maxDays: number }) {
    super("testing_license_lifetime_too_long", `A testing license lasts at most ${maxDays} days`, {
      httpStatus: 422,
      fault: "customer",
      meta: { maxDays },
    });
    this.name = "TestingLicenseLifetimeTooLongError";
  }
}

/** A service token expires within a year. */
export class TestingLicenseServiceTokenLifetimeTooLongError extends HandledError {
  declare readonly code: "testing_license_service_token_lifetime_too_long";

  constructor({ maxDays }: { maxDays: number }) {
    super(
      "testing_license_service_token_lifetime_too_long",
      `A service token expires within ${maxDays} days`,
      { httpStatus: 422, fault: "customer", meta: { maxDays } },
    );
    this.name = "TestingLicenseServiceTokenLifetimeTooLongError";
  }
}

/** No token, a malformed one, or one Cloud never issued. */
export class TestingLicenseTokenInvalidError extends HandledError {
  declare readonly code: "testing_license_token_invalid";

  constructor() {
    super("testing_license_token_invalid", "This testing license token is not valid", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "TestingLicenseTokenInvalidError";
  }
}

/** The token ran out; a person signs in again, a CI job needs a new service token. */
export class TestingLicenseTokenExpiredError extends HandledError {
  declare readonly code: "testing_license_token_expired";

  constructor() {
    super("testing_license_token_expired", "This testing license token has expired", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "TestingLicenseTokenExpiredError";
  }
}

/** An ops manager revoked the token. */
export class TestingLicenseTokenRevokedError extends HandledError {
  declare readonly code: "testing_license_token_revoked";

  constructor() {
    super("testing_license_token_revoked", "This testing license token was revoked", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "TestingLicenseTokenRevokedError";
  }
}

/** No token with that id. */
export class TestingLicenseTokenNotFoundError extends HandledError {
  declare readonly code: "testing_license_token_not_found";

  constructor() {
    super("testing_license_token_not_found", "Testing license token not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "TestingLicenseTokenNotFoundError";
  }
}
