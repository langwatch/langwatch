/**
 * The email ceilings, counted fleet-wide on the process's Redis. Every command touches one key,
 * so a cluster never refuses it; the window and claim keys are the service's, verbatim.
 */
import type { RedisConnection } from "@langwatch/redis-client";
import type { Instant } from "@langwatch/time";

import {
  AutomationEmailCapRepository,
  type EmailCapClaim,
  type EmailCapSend,
} from "../automation-email-cap.repository.ts";

const EXPIRE_IF_UNSET_SCRIPT = `
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
`;

type EmailCapConnection = Pick<RedisConnection, "set" | "get" | "incrby" | "eval">;

export class RedisAutomationEmailCapRepository extends AutomationEmailCapRepository {
  static create(input: { connection: EmailCapConnection }): RedisAutomationEmailCapRepository {
    return new RedisAutomationEmailCapRepository(input.connection);
  }

  private constructor(private readonly connection: EmailCapConnection) {
    super();
  }

  async claimSend(send: EmailCapSend): Promise<EmailCapClaim> {
    const claimed = await this.connection.set(send.claim, "1", "EX", send.ttlSeconds, "NX");
    if (claimed === null) return { outcome: "already-counted" };

    const count = await this.connection.incrby(send.window, send.sends);
    await this.connection.eval(EXPIRE_IF_UNSET_SCRIPT, 1, send.window, String(send.ttlSeconds));
    return { outcome: "counted", count };
  }

  async countSends(input: Readonly<{ window: string; now: Instant }>): Promise<number> {
    const count = await this.connection.get(input.window);
    return count === null ? 0 : Number(count);
  }
}
