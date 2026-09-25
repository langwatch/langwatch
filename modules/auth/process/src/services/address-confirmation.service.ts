import type { AddressConfirmation } from "@langwatch/auth-contract";

export interface AddressConfirmationServiceDeps {
  /** Whether the account holding this address has confirmed it; false where none holds it. */
  isConfirmed(input: { email: string }): Promise<boolean>;
}

/**
 * The caller's own address and whether it is confirmed, the read behind the
 * "we have not confirmed this yet" nudge. It answers only about the session's address.
 */
export class AddressConfirmationService {
  static create(deps: AddressConfirmationServiceDeps): AddressConfirmationService {
    return new AddressConfirmationService(deps);
  }

  private constructor(private readonly deps: AddressConfirmationServiceDeps) {}

  async getForCaller({ email }: { email: string | null }): Promise<AddressConfirmation> {
    if (!email) return { email: null, confirmed: false };

    return { email, confirmed: await this.deps.isConfirmed({ email }) };
  }
}
