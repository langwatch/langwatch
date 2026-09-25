import {
  type SignUpVerificationLink,
  SignUpVerificationMailChannel,
} from "../sign-up-verification-mail.channel.ts";

/** Records each link it is handed and sends nothing. */
export class MemorySignUpVerificationMailChannel extends SignUpVerificationMailChannel {
  static create(): MemorySignUpVerificationMailChannel {
    return new MemorySignUpVerificationMailChannel();
  }

  readonly sent: SignUpVerificationLink[] = [];

  private constructor() {
    super();
  }

  async sendVerificationLink(input: SignUpVerificationLink): Promise<void> {
    this.sent.push(input);
  }
}
