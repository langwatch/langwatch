/**
 * Refusals of a hosted-service call (ADR-141). Each one names something the
 * administrator of the calling install can act on. Customer copy is keyed off
 * the code in `src/features/errors/logic/presentation.ts`.
 */

import { HandledError } from "@langwatch/handled-error";

/** The license is valid, and the service is not part of what was agreed. */
export class ConnectServiceNotEntitledError extends HandledError {
  declare readonly code: "connect_service_not_entitled";

  constructor(service: string) {
    super(
      "connect_service_not_entitled",
      "This license does not include the requested hosted service",
      { httpStatus: 403, fault: "customer", meta: { service } },
    );
    this.name = "ConnectServiceNotEntitledError";
  }
}

/** A virtual key asked to change a contract cap, which only a license holds. */
export class ConnectLicenseRequiredError extends HandledError {
  declare readonly code: "connect_license_required";

  constructor() {
    super(
      "connect_license_required",
      "Only a self-hosted license can change its own hosted usage cap here",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "ConnectLicenseRequiredError";
  }
}

/** No commit or overage was agreed yet, so there is no cap to move. */
export class ConnectBudgetNotSetError extends HandledError {
  declare readonly code: "connect_budget_not_set";

  constructor() {
    super(
      "connect_budget_not_set",
      "No hosted usage budget has been agreed for this license yet",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "ConnectBudgetNotSetError";
  }
}

/** The cap asked for is above the commit plus the agreed overage maximum. */
export class ConnectBudgetAboveContractMaximumError extends HandledError {
  declare readonly code: "connect_budget_above_contract_maximum";

  constructor(maximumUsd: number) {
    super(
      "connect_budget_above_contract_maximum",
      "The cap is above the maximum agreed for this license",
      { httpStatus: 400, fault: "customer", meta: { maximumUsd } },
    );
    this.name = "ConnectBudgetAboveContractMaximumError";
  }
}
