import type { RedisConnection } from "@langwatch/redis-client";

import type { AuthChannels } from "../auth.channels.ts";
import { RedisCliDeviceSettlementChannel } from "./redis.cli-device-settlement.channel.ts";

/** A device-code settlement reaches every pod over the deployment's Redis pub/sub. */
export class RedisAuthChannels {
  static readonly requires = ["redis"] as const;

  static create({ redis }: { redis: RedisConnection }): AuthChannels {
    return { cliSettlements: RedisCliDeviceSettlementChannel.create(redis) };
  }
}
