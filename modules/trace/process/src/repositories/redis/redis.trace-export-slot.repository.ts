import type { ProcessMembers } from "@langwatch/process-stores/members";

import { TraceExportSlotRepository } from "../trace-export-slot.repository.ts";

/** Export slots over the process's Redis: a claim is one `SET key value EX seconds NX`. */
export class RedisTraceExportSlotRepository extends TraceExportSlotRepository {
  static create(input: { connection: ProcessMembers["redis"] }): RedisTraceExportSlotRepository {
    return new RedisTraceExportSlotRepository(input.connection);
  }

  #connection: ProcessMembers["redis"];

  private constructor(connection: ProcessMembers["redis"]) {
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
