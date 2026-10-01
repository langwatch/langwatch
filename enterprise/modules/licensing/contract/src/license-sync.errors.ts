// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Refusals of a presented license token on the connect host (ADR-156, section 6).
 * The same codes the gateway answers, so one piece of copy on the install covers
 * both hosts; none says anything about the customer, the seats or the term.
 */

import { HandledError } from "@langwatch/handled-error";

export class ConnectLicenseTokenMalformedError extends HandledError {
  declare readonly code: "connect_license_token_malformed";

  constructor() {
    super("connect_license_token_malformed", "The license token is malformed", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ConnectLicenseTokenMalformedError";
  }
}

export class ConnectLicenseNotRegisteredError extends HandledError {
  declare readonly code: "connect_license_not_registered";

  constructor() {
    super("connect_license_not_registered", "This license is not registered for hosted services", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ConnectLicenseNotRegisteredError";
  }
}

export class ConnectLicenseRevokedError extends HandledError {
  declare readonly code: "connect_license_revoked";

  constructor() {
    super("connect_license_revoked", "This license is no longer active", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ConnectLicenseRevokedError";
  }
}

export class ConnectLicenseExpiredError extends HandledError {
  declare readonly code: "connect_license_expired";

  constructor() {
    super("connect_license_expired", "This license has expired", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ConnectLicenseExpiredError";
  }
}

export class ConnectWrongInstanceError extends HandledError {
  declare readonly code: "connect_wrong_instance";

  constructor() {
    super("connect_wrong_instance", "This license is bound to another instance", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ConnectWrongInstanceError";
  }
}

/** A sync carries a version and two whole, non-negative seat counts, and nothing else. */
export class LicenseSyncPayloadInvalidError extends HandledError {
  declare readonly code: "validation_error";

  constructor() {
    super("validation_error", "A sync carries a version and two seat counts", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "LicenseSyncPayloadInvalidError";
  }
}

export class LicenseSyncRateLimitedError extends HandledError {
  declare readonly code: "rate_limited";

  constructor() {
    super("rate_limited", "This license has synced too many times today", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
    });
    this.name = "LicenseSyncRateLimitedError";
  }
}
