// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Handled errors for the license registry (ADR-156). The callers are LangWatch
 * operators in the admin console, so each one names a cause an operator can act on.
 */

import { HandledError } from "@langwatch/handled-error";

/**
 * No signing key is configured on this deployment, so no license can be issued.
 * A platform fault: the operator pressing the button supplied nothing wrong.
 */
export class LicenseSigningNotConfiguredError extends HandledError {
  declare readonly code: "license_signing_not_configured";

  constructor() {
    super(
      "license_signing_not_configured",
      "License signing is not configured on this deployment",
      { httpStatus: 412, fault: "platform" },
    );
    this.name = "LicenseSigningNotConfiguredError";
  }
}

/** A license asked to end at a moment already passed: 422, like a grant's past expiry. */
export class LicenseExpiryInPastError extends HandledError {
  declare readonly code: "license_expiry_in_past";

  constructor() {
    super("license_expiry_in_past", "A license's end date must be in the future", {
      httpStatus: 422,
      fault: "customer",
    });
    this.name = "LicenseExpiryInPastError";
  }
}

/** The registry has no license with that id. */
export class IssuedLicenseNotFoundError extends HandledError {
  declare readonly code: "issued_license_not_found";

  constructor() {
    super("issued_license_not_found", "License not found in the registry", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "IssuedLicenseNotFoundError";
  }
}

/** The pasted license is already in the registry. The existing row is untouched. */
export class LicenseAlreadyRegisteredError extends HandledError {
  declare readonly code: "license_already_registered";

  constructor() {
    super("license_already_registered", "This license is already in the registry", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "LicenseAlreadyRegisteredError";
  }
}

/**
 * The action needs an active license, and this one is revoked, superseded or
 * past its term. The admin console names the state in its copy.
 */
export class IssuedLicenseNotActiveError extends HandledError {
  declare readonly code: "issued_license_not_active";

  constructor(status: "revoked" | "superseded" | "expired") {
    super(
      "issued_license_not_active",
      `This license is ${status}, so it cannot be changed this way`,
      { httpStatus: 409, fault: "customer", meta: { status } },
    );
    this.name = "IssuedLicenseNotActiveError";
  }
}

/**
 * The license was already reissued. Its replacement is the one to reissue, so
 * that every license is replaced by one license at most.
 */
export class LicenseAlreadyReissuedError extends HandledError {
  declare readonly code: "license_already_reissued";

  constructor() {
    super(
      "license_already_reissued",
      "This license was already reissued. Reissue its replacement instead",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "LicenseAlreadyReissuedError";
  }
}

/** An overage maximum was given while on-demand overage is off. */
export class LicenseOverageMaxRequiresOverageError extends HandledError {
  declare readonly code: "license_overage_max_requires_overage";

  constructor() {
    super(
      "license_overage_max_requires_overage",
      "An overage maximum only applies when on-demand overage is enabled",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "LicenseOverageMaxRequiresOverageError";
  }
}

/** A testing licence stays on the instance it was approved for; a new instance needs approval. */
export class TestingLicenseBindingResetRefusedError extends HandledError {
  declare readonly code: "testing_license_binding_reset_refused";

  constructor() {
    super(
      "testing_license_binding_reset_refused",
      "A testing license cannot be moved to another instance",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "TestingLicenseBindingResetRefusedError";
  }
}

/** A testing or unknown-kind row without the instance or organization it is for: unreissuable. */
export class TestingLicenseBindingMissingError extends HandledError {
  declare readonly code: "testing_license_binding_missing";

  constructor() {
    super(
      "testing_license_binding_missing",
      "This license names no instance or organization, so it cannot be reissued",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "TestingLicenseBindingMissingError";
  }
}
