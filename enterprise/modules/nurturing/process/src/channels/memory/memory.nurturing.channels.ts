import type { NurturingChannels } from "../nurturing.channels.ts";
import { MemoryCustomerIoChannel } from "./memory.customer-io.channel.ts";
import { MemoryPostHogChannel } from "./memory.posthog.channel.ts";

/** Both vendors are recorded in-process; nothing is sent. */
export class MemoryNurturingChannels {
  static readonly requires = [] as const;

  static create(): NurturingChannels {
    return {
      customerIo: MemoryCustomerIoChannel.create(),
      posthog: MemoryPostHogChannel.create(),
    };
  }
}
