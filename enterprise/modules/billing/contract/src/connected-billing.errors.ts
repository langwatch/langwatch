// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What invoice billing for a connected self-hosted customer refuses
 * (ADR-156 section 7). Every one is something the operator can act on.
 */

import { HandledError } from "@langwatch/handled-error";

/** The invoicing side of connected billing runs on LangWatch Cloud alone. */
export class ConnectedBillingUnavailableError extends HandledError {
  declare readonly code: "connected_billing_unavailable";

  constructor() {
    super(
      "connected_billing_unavailable",
      "Billing for connected customers is only available on LangWatch Cloud",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "ConnectedBillingUnavailableError";
  }
}

/**
 * The commit is agreed on the license and billing follows it, never the other
 * way, so a figure that disagrees with the license is refused rather than
 * invoiced. `licenseCommitUsd` is what the license says.
 */
export class ConnectedBillingCommitMismatchError extends HandledError {
  declare readonly code: "connected_billing_commit_mismatch";

  constructor(licenseCommitUsd: number) {
    super(
      "connected_billing_commit_mismatch",
      "The commit does not match what the license terms say",
      { httpStatus: 400, fault: "customer", meta: { licenseCommitUsd } },
    );
    this.name = "ConnectedBillingCommitMismatchError";
  }
}

/** No billing account: finance invoices this customer by hand. */
export class ConnectedBillingNotOnboardedError extends HandledError {
  declare readonly code: "connected_billing_not_onboarded";

  constructor() {
    super("connected_billing_not_onboarded", "This customer has no billing account yet", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ConnectedBillingNotOnboardedError";
  }
}
