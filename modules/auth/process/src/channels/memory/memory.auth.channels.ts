import type { AuthChannels } from "../auth.channels.ts";
import { MemoryCliDeviceSettlementChannel } from "./memory.cli-device-settlement.channel.ts";

/** A settlement is heard inside the one process, which is every test's. */
export class MemoryAuthChannels {
  static readonly requires = [] as const;

  static create(): AuthChannels {
    return { cliSettlements: MemoryCliDeviceSettlementChannel.create() };
  }
}
