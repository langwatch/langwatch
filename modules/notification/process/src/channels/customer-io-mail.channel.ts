import type {
  NurturingApi,
  TransactionalEmail,
  TransactionalEmailOutcome,
} from "@langwatch/enterprise-nurturing-contract";

/**
 * Where a Cloud send of a routed template goes first. Nurturing alone talks to Customer.io
 * (AGENTS.md), so notification holds this port and the module binds it to nurturing.
 */
export abstract class CustomerIoMailChannel {
  /** One recipient's rendered message; a refusal or `off` is an answer, never a throw. */
  abstract send(email: TransactionalEmail): Promise<TransactionalEmailOutcome>;
}

/** The port answered by nurturing's transactional email. */
export class NurturingCustomerIoMailChannel extends CustomerIoMailChannel {
  static create(
    nurturing: Pick<NurturingApi, "sendTransactionalEmail">,
  ): NurturingCustomerIoMailChannel {
    return new NurturingCustomerIoMailChannel(nurturing);
  }

  private constructor(private readonly nurturing: Pick<NurturingApi, "sendTransactionalEmail">) {
    super();
  }

  send(email: TransactionalEmail): Promise<TransactionalEmailOutcome> {
    return this.nurturing.sendTransactionalEmail(email);
  }
}
