import { TraceCapabilityUnavailableError } from "@langwatch/trace-contract";

import {
  TraceClickHouse,
  type TraceClickHouseClient,
} from "../clickhouse/clickhouse.trace-member-client.repository.ts";

/** The memory tier opens no ClickHouse: a raw tenant client is refused by name, never faked. */
export class MemoryTraceClickHouseClientsRepository extends TraceClickHouse {
  static create(): MemoryTraceClickHouseClientsRepository {
    return new MemoryTraceClickHouseClientsRepository();
  }

  private constructor() {
    super();
  }

  resolve(): Promise<TraceClickHouseClient> {
    return Promise.reject(new TraceCapabilityUnavailableError("memory", "a ClickHouse client"));
  }
}
