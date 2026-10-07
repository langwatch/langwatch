import type {
  ClickHouseHealthRepository,
  PostgresHealthRepository,
  RedisHealthRepository,
} from "../datastore-health.repository.ts";

/** A healthy Postgres. */
export class MemoryPostgresHealthRepository implements PostgresHealthRepository {
  private constructor() {}

  static create(): MemoryPostgresHealthRepository {
    return new MemoryPostgresHealthRepository();
  }

  async findServerVersion(): Promise<string> {
    return "memory";
  }
}

/** A healthy ClickHouse. */
export class MemoryClickHouseHealthRepository implements ClickHouseHealthRepository {
  private constructor() {}

  static create(): MemoryClickHouseHealthRepository {
    return new MemoryClickHouseHealthRepository();
  }

  async ping(): Promise<void> {}
}

/** A healthy Redis. */
export class MemoryRedisHealthRepository implements RedisHealthRepository {
  private constructor() {}

  static create(): MemoryRedisHealthRepository {
    return new MemoryRedisHealthRepository();
  }

  describeTarget(): string {
    return "memory";
  }

  async ping(): Promise<void> {}
}
