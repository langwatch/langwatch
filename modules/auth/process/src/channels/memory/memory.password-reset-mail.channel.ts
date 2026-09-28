import {
  type PasswordResetLink,
  PasswordResetMailChannel,
} from "../password-reset-mail.channel.ts";

/** Records each link it is handed and sends nothing. */
export class MemoryPasswordResetMailChannel extends PasswordResetMailChannel {
  static create(): MemoryPasswordResetMailChannel {
    return new MemoryPasswordResetMailChannel();
  }

  readonly sent: PasswordResetLink[] = [];

  private constructor() {
    super();
  }

  async sendResetLink(input: PasswordResetLink): Promise<void> {
    this.sent.push(input);
  }
}
