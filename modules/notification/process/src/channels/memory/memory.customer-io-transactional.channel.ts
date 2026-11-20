import {
  CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
  type CustomerIoTransactionalRequest,
} from "../customer-io-transactional.channel.ts";

/** How a scripted send fails, as the HTTP client reports each kind. */
export type CustomerIoScriptedFailure =
  | { kind: "status"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

/**
 * Records every request it is handed, accepted or not, so a test reads back what would have
 * reached Customer.io. A recipient told to fail is refused the way the HTTP client refuses.
 */
export class MemoryCustomerIoTransactionalChannel extends CustomerIoTransactionalChannel {
  static create(): MemoryCustomerIoTransactionalChannel {
    return new MemoryCustomerIoTransactionalChannel();
  }

  readonly requests: CustomerIoTransactionalRequest[] = [];
  closeCalls = 0;

  private readonly failures = new Map<string, CustomerIoScriptedFailure>();

  private constructor() {
    super();
  }

  /** Every send to `recipient` (any recipient when omitted) fails this way from now on. */
  failFor(failure: CustomerIoScriptedFailure, recipient = "*"): this {
    this.failures.set(recipient, failure);
    return this;
  }

  async send(request: CustomerIoTransactionalRequest): Promise<{ deliveryId: string }> {
    this.requests.push(request);
    const failure = this.failures.get(request.to) ?? this.failures.get("*");
    if (failure?.kind === "status") {
      throw new CustomerIoTransactionalError("status", failure.status);
    }
    if (failure) throw new CustomerIoTransactionalError(failure.kind);
    return { deliveryId: `delivery-${this.requests.length}` };
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}
