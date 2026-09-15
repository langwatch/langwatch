import { TaskInfrastructureUnavailableError } from "./task.errors.ts";

/**
 * What a task may reach: infrastructure handles the composing process built
 * for real, or left absent when this environment doesn't have it. A missing
 * handle is a named absence, logged once at boot — never a silent stub — and
 * `require*` throws `TaskInfrastructureUnavailableError` naming the handle
 * rather than a null-pointer trace three calls deep. See
 * `dev/docs/adr/102-runtime-composition-roots.md` for the rest.
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
