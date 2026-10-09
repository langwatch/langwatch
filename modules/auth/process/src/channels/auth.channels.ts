import type { CliDeviceSettlementChannel } from "./cli-device-settlement.channel.ts";

/** Every channel auth holds, as the container hands them to the module class. */
export interface AuthChannels {
  readonly cliSettlements: CliDeviceSettlementChannel;
}
