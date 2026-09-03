import { TaskInfrastructureUnavailableError } from "./task.errors";

/**
 * What a task may reach: infrastructure handles the composing process built
 * for real, or left absent because this environment doesn't have it (no
 * `DATABASE_URL`, no `CLICKHOUSE_URL`, ...). A missing handle is a named
 * absence, logged once at boot by the composition root — never a stub that
 * quietly does nothing. A task that needs a handle calls the matching
 * `require*` helper and gets a `TaskInfrastructureUnavailableError` naming
 * the handle, not a null-pointer stack trace three calls deep.
 *
 * Concrete hosts fill in the type parameters with their real handle types
 * (a `PrismaClient`, a ClickHouse client, ...) so `require*` returns a typed
 * value rather than `unknown`. `config` is always present — every process
 * has *some* configuration, even if most of its leaves are unset — so it has
 * no `require*` counterpart.
 *
 * The type parameters default to `unknown` so a plugin can implement `Task`
 * without the generated Prisma client. See
 * `dev/docs/plans/tasks-launch-interface-and-saas.md` Part 2 for the rest.
 */
export abstract class TaskHostPort<
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
