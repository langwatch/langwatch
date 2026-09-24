/**
 * The email ceilings, counted fleet-wide on the process's Redis. THE KEY FORMAT
 * IS OWNED BY `AutomationEmailCapService`: this only binds its five operations.
 */
import type { RedisConnection } from "@langwatch/redis-client";

import { AutomationEmailCapRepository } from "../automation-email-cap.repository.ts";

export class RedisAutomationEmailCapRepository extends AutomationEmailCapRepository {
  static create(input: {
    connection: Pick<RedisConnection, "set" | "get" | "incr" | "incrby" | "eval">;
  }): RedisAutomationEmailCapRepository {
    return new RedisAutomationEmailCapRepository(input.connection);
  }

  private constructor(
    private readonly connection: Pick<RedisConnection, "set" | "get" | "incr" | "incrby" | "eval">,
  ) {
    super();
  }

  async claim(
    key: string,
    value: string,
    expiry: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<"claimed" | "already-claimed"> {
    const reply = await this.connection.set(key, value, expiry, seconds, condition);
    return reply === null ? "already-claimed" : "claimed";
  }

  findValue(key: string): Promise<string | null> {
    return this.connection.get(key);
  }

  incr(key: string): Promise<number> {
    return this.connection.incr(key);
  }

  incrby(key: string, increment: number): Promise<number> {
    return this.connection.incrby(key, increment);
  }

  eval(script: string, keyCount: number, key: string, seconds: string): Promise<unknown> {
    return this.connection.eval(script, keyCount, key, seconds);
  }
}
