import type { RedisConnection } from "@langwatch/redis-client";

import { TraceExportSlotRepository } from "../trace-export-slot.repository.ts";

/** Export slots over the process's Redis: a claim is one `SET key value EX seconds NX`. */
export class RedisTraceExportSlotRepository extends TraceExportSlotRepository {
  static create(input: { connection: RedisConnection }): RedisTraceExportSlotRepository {
    return new RedisTraceExportSlotRepository(input.connection);
  }

  #connection: RedisConnection;

  private constructor(connection: RedisConnection) {
    super();
    this.#connection = connection;
  }

  async claim(key: string, value: string, expirySeconds: number): Promise<boolean> {
    return (await this.#connection.set(key, value, "EX", expirySeconds, "NX")) === "OK";
  }

  del(key: string): Promise<number> {
    return this.#connection.del(key);
  }
}
