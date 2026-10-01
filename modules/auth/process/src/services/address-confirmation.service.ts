import { type AddressConfirmation, EmailSendingUnavailableError } from "@langwatch/auth-contract";

export interface AddressConfirmationServiceDeps {
  /** Whether the account holding this address has confirmed it; false where none holds it. */
  isConfirmed(input: { email: string }): Promise<boolean>;
  /** Whether this installation names a way to send email at all. */
  hasMailDelivery(): Promise<boolean>;
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
    const canSendConfirmation = await this.deps.hasMailDelivery();
    if (!email) return { email: null, confirmed: false, canSendConfirmation };

    return { email, confirmed: await this.deps.isConfirmed({ email }), canSendConfirmation };
  }

  /** Refuses by name where no link could go out, rather than skipping the send silently. */
  async assertCanSend(): Promise<void> {
    if (!(await this.deps.hasMailDelivery())) throw new EmailSendingUnavailableError();
  }
}
