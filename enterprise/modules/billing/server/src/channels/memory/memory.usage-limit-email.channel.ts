import { UsageLimitEmailChannel } from "../usage-limit-email.channel.ts";

/** Accepts the approaching-limit mail and sends nothing, where no mailer is composed. */
export class MemoryUsageLimitEmailChannel extends UsageLimitEmailChannel {
  private constructor() {
    super();
  }

  static create(): MemoryUsageLimitEmailChannel {
    return new MemoryUsageLimitEmailChannel();
  }

  async send(): Promise<void> {}
}
