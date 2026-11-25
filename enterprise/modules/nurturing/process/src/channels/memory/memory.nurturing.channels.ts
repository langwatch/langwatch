import type { NurturingChannels } from "../nurturing.channels.ts";
import { MemoryCustomerIoChannel } from "./memory.customer-io.channel.ts";
import { MemoryPostHogChannel } from "./memory.posthog.channel.ts";

/**
 * Both vendors are recorded in-process; nothing is sent. Transactional email is off, so a
 * caller's own mailer still delivers it rather than a recorder swallowing it.
 */
export class MemoryNurturingChannels {
  static readonly requires = [] as const;

  static create(): NurturingChannels {
    return {
      customerIo: MemoryCustomerIoChannel.create(),
      customerIoTransactional: void 0,
      posthog: MemoryPostHogChannel.create(),
    };
  }
}
