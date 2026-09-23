// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Refusals of a hosted-service call (ADR-156). Each one names something the
 * administrator of the calling install can act on.
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
    super("connect_budget_not_set", "No hosted usage budget has been agreed for this license yet", {
      httpStatus: 409,
      fault: "customer",
    });
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

/**
 * Connect is off in this deployment, so there is nothing to change. Only the
 * caller knows this; the host is never reached to say it.
 */
export class ConnectDisabledError extends HandledError {
  declare readonly code: "connect_disabled";

  constructor() {
    super("connect_disabled", "Connect is switched off in this deployment configuration", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "ConnectDisabledError";
  }
}

/** The hosted usage budget is spent. The cap is the customer's own to raise. */
export class ConnectBudgetExhaustedError extends HandledError {
  declare readonly code: "connect_budget_exhausted";

  constructor(options: { capUsd?: number } = {}) {
    super("connect_budget_exhausted", "The hosted usage budget for this license is spent", {
      httpStatus: 402,
      fault: "customer",
      meta: options.capUsd === undefined ? {} : { capUsd: options.capUsd },
    });
    this.name = "ConnectBudgetExhaustedError";
  }
}

/**
 * The host was not reached. Names the host and port, because the fix is an
 * outbound rule in a network the administrator owns and nothing else can say
 * which one to write.
 */
export class ConnectUnreachableError extends HandledError {
  declare readonly code: "connect_unreachable";

  constructor({ host, port, cause }: { host: string; port: number; cause?: Error }) {
    super("connect_unreachable", "LangWatch-hosted services were not reached", {
      httpStatus: 503,
      fault: "customer",
      meta: { host, port },
      ...(cause ? { reasons: [cause] } : {}),
    });
    this.name = "ConnectUnreachableError";
  }
}

/**
 * The host answered, and what it answered is a failure on the LangWatch side.
 * The same code the gateway raises for it, so one piece of copy covers both.
 */
export class HostedServiceUnavailableError extends HandledError {
  declare readonly code: "hosted_service_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("hosted_service_unavailable", "The hosted service did not answer with a result", {
      httpStatus: 503,
      fault: "platform",
      ...(options.reasons ? { reasons: options.reasons } : {}),
    });
    this.name = "HostedServiceUnavailableError";
  }
}

/**
 * A connected call arrived without the instance id every install presents.
 * The credential path answers this as a refusal code; the activation route
 * throws it, because there the caller is a person pasting a code.
 */
export class ConnectInstanceRequiredError extends HandledError {
  declare readonly code: "connect_instance_required";

  constructor() {
    super("connect_instance_required", "This call must name the installation it comes from", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ConnectInstanceRequiredError";
  }
}
