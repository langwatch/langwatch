/**
 * Refusals the install side of Connect raises itself (ADR-141).
 *
 * The host names most of its own refusals, and those cross the wire as their
 * own codes with copy already written for them. These three are what only the
 * caller knows: that its deployment never switched Connect on, that the budget
 * the host stopped on belongs to a cap an organization admin can raise here,
 * and that the host was never reached at all.
 *
 * Customer copy is keyed off the code in
 * `src/features/errors/logic/presentation.ts`.
 */

import { HandledError } from "@langwatch/handled-error";

/** Connect is off in this deployment, so there is nothing to change. */
export class ConnectDisabledError extends HandledError {
  declare readonly code: "connect_disabled";

  constructor() {
    super(
      "connect_disabled",
      "Connect is switched off in this deployment configuration",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "ConnectDisabledError";
  }
}

/** The hosted usage budget is spent. The cap is the customer's own to raise. */
export class ConnectBudgetExhaustedError extends HandledError {
  declare readonly code: "connect_budget_exhausted";

  constructor(options: { capUsd?: number } = {}) {
    super(
      "connect_budget_exhausted",
      "The hosted usage budget for this license is spent",
      {
        httpStatus: 402,
        fault: "customer",
        meta: options.capUsd === undefined ? {} : { capUsd: options.capUsd },
      },
    );
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

  constructor({
    host,
    port,
    cause,
  }: {
    host: string;
    port: number;
    cause?: Error;
  }) {
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
 * Same code the gateway raises for it, so one piece of copy covers both.
 */
export class HostedServiceUnavailableError extends HandledError {
  declare readonly code: "hosted_service_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "hosted_service_unavailable",
      "The hosted service did not answer with a result",
      {
        httpStatus: 503,
        fault: "platform",
        ...(options.reasons ? { reasons: options.reasons } : {}),
      },
    );
    this.name = "HostedServiceUnavailableError";
  }
}
