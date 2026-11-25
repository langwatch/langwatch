// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Refusals of sending, receiving and downloading upgrade diagnostics. */
import { HandledError, remediation } from "@langwatch/handled-error";

/** Connect is permitted and the install holds no licence whose token LangWatch can verify. */
export class UpgradeDiagnosticsLicenseRequiredError extends HandledError {
  declare readonly code: "upgrade_diagnostics_license_required";

  constructor() {
    super(
      "upgrade_diagnostics_license_required",
      "Sending diagnostics to LangWatch needs a LangWatch licence on this install",
      {
        httpStatus: 409,
        fault: "customer",
        ...remediation("upgrade_diagnostics_license_required"),
      },
    );
    this.name = "UpgradeDiagnosticsLicenseRequiredError";
  }
}

/** One instance sent its daily allowance of bundles. */
export class UpgradeDiagnosticsRateLimitedError extends HandledError {
  declare readonly code: "upgrade_diagnostics_rate_limited";

  constructor() {
    super("upgrade_diagnostics_rate_limited", "This install has sent too many diagnostics today", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
      ...remediation("upgrade_diagnostics_rate_limited"),
    });
    this.name = "UpgradeDiagnosticsRateLimitedError";
  }
}

/** No received report has that id; it may have expired. */
export class UpgradeDiagnosticsNotFoundError extends HandledError {
  declare readonly code: "upgrade_diagnostics_not_found";

  constructor() {
    super("upgrade_diagnostics_not_found", "No diagnostics report with that id", {
      httpStatus: 404,
      fault: "customer",
      ...remediation("upgrade_diagnostics_not_found"),
    });
    this.name = "UpgradeDiagnosticsNotFoundError";
  }
}
