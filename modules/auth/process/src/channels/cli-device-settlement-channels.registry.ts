import { MemoryCliDeviceSettlementChannel } from "./memory/memory.cli-device-settlement.channel.ts";
import { RedisCliDeviceSettlementChannel } from "./redis/redis.cli-device-settlement.channel.ts";

export const cliDeviceSettlementChannels = {
  live: RedisCliDeviceSettlementChannel,
  memory: MemoryCliDeviceSettlementChannel,
};
