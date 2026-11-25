import type {
  TransactionalEmail,
  TransactionalEmailOutcome,
} from "@langwatch/enterprise-nurturing-contract";

import { CustomerIoMailChannel } from "../customer-io-mail.channel.ts";

/** What the fake answers a send it was told to refuse, as nurturing would. */
export type CustomerIoMailRefusal = Extract<TransactionalEmailOutcome, { outcome: "refused" }>;

/**
 * Records every email handed to it, so a test reads back what would have reached Customer.io.
 * It queues by default; told to, it refuses one recipient or all, or answers `off` as nurturing
 * does without the App API key.
 */
export class MemoryCustomerIoMailChannel extends CustomerIoMailChannel {
  static create(): MemoryCustomerIoMailChannel {
    return new MemoryCustomerIoMailChannel();
  }

  readonly sent: TransactionalEmail[] = [];

  private readonly refusals = new Map<string, CustomerIoMailRefusal>();
  private off = false;

  private constructor() {
    super();
  }

  /** Every send to `recipient` (any recipient when omitted) is refused this way from now on. */
  refuse(refusal: CustomerIoMailRefusal, recipient = "*"): this {
    this.refusals.set(recipient, refusal);
    return this;
  }

  /** Answers `off` from now on and records nothing, as nurturing does with no App API key. */
  turnOff(): this {
    this.off = true;
    return this;
  }

  async send(email: TransactionalEmail): Promise<TransactionalEmailOutcome> {
    if (this.off) return { outcome: "off" };
    this.sent.push(email);
    const refusal = this.refusals.get(email.to) ?? this.refusals.get("*");
    return refusal ?? { outcome: "queued", deliveryId: `delivery-${this.sent.length}` };
  }
}
