/**
 * The two answers single sign-on needs from THIS process: where the gate writes
 * what it decided, and the connection ledger — or the refusal that stands in
 * for one, on a deployment that composed no identity pipeline to command.
 */
import { SsoConnectionLedgerPort, SsoGateLoggerPort } from "@langwatch/enterprise-api";
import type { Logger } from "@langwatch/observability";

import { ApiEnterpriseUnavailableError } from "../enterprise/enterprise.composition.ts";

/** Where the gate says what it decided, on this process's own logger. */
export class ApiSsoGateLogger extends SsoGateLoggerPort {
  static create(logger: Pick<Logger, "info" | "warn">): ApiSsoGateLogger {
    return new ApiSsoGateLogger(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info" | "warn">) {
    super();
  }

  info(context: object, message: string): void {
    this.logger.info(context, message);
  }

  warn(context: object, message: string): void {
    this.logger.warn(context, message);
  }
}

/**
 * The connection ledger a deployment that composed no identity pipeline has.
 *
 * Every verb refuses by name rather than answering off a half-built object: the
 * back office reads a MEMBER of the Enterprise application, and a deployment
 * that composed seven of the eight must still say which one it does not have.
 */
export class ApiUnavailableSsoConnectionLedger extends SsoConnectionLedgerPort {
  static create(): ApiUnavailableSsoConnectionLedger {
    return new ApiUnavailableSsoConnectionLedger();
  }

  list(): never {
    return this.refuse();
  }

  findById(): never {
    return this.refuse();
  }

  registerConnection(): never {
    return this.refuse();
  }

  claimDomain(): never {
    return this.refuse();
  }

  approveDomainClaim(): never {
    return this.refuse();
  }

  rejectDomainClaim(): never {
    return this.refuse();
  }

  attestDomain(): never {
    return this.refuse();
  }

  activateConnection(): never {
    return this.refuse();
  }

  suspendConnection(): never {
    return this.refuse();
  }

  resumeConnection(): never {
    return this.refuse();
  }

  requestTeardown(): never {
    return this.refuse();
  }

  private refuse(): never {
    throw new ApiEnterpriseUnavailableError(
      "Enterprise single sign-on ledger, so it can neither read nor command a connection",
    );
  }
}
