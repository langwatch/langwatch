import { TaskInfrastructureUnavailableError } from "./task.errors.ts";

/**
 * Missing handles throw by name rather than degrading to silent stubs.
 * See ADR-102.
 */
export abstract class TaskHost<
  Config = unknown,
  Prisma = unknown,
  ClickHouse = unknown,
  Redis = unknown,
  ObjectStorage = unknown,
> {
  abstract readonly prisma: Prisma | undefined;
  abstract readonly clickhouse: ClickHouse | undefined;
  abstract readonly redis: Redis | undefined;
  abstract readonly objectStorage: ObjectStorage | undefined;
  abstract readonly config: Config;

  requirePrisma(): Prisma {
    return requireHandle(this.prisma, "a database connection");
  }

  requireClickhouse(): ClickHouse {
    return requireHandle(this.clickhouse, "a ClickHouse connection");
  }

  requireRedis(): Redis {
    return requireHandle(this.redis, "a Redis connection");
  }

  requireObjectStorage(): ObjectStorage {
    return requireHandle(this.objectStorage, "object storage");
  }
}

function requireHandle<T>(handle: T | undefined, name: string): T {
  if (handle === undefined) {
    throw new TaskInfrastructureUnavailableError({ handle: name });
  }
  return handle;
}
