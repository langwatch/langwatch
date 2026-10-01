import {
  type AddressConfirmation,
  AddressConfirmationMailChannel,
} from "../address-confirmation-mail.channel.ts";

/** Records each confirmation it is handed and sends nothing. */
export class MemoryAddressConfirmationMailChannel extends AddressConfirmationMailChannel {
  static create(): MemoryAddressConfirmationMailChannel {
    return new MemoryAddressConfirmationMailChannel();
  }

  readonly sent: AddressConfirmation[] = [];

  private constructor() {
    super();
  }

  async sendConfirmation(input: AddressConfirmation): Promise<void> {
    this.sent.push(input);
  }
}
