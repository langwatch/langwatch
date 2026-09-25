/**
 * Built EAGERLY at boot, not re-derived per use — two constructions of the
 * same client would split one process into duplicate caches and dedup
 * keyspaces. An unconfigured member REFUSES BY NAME, never a silent omission.
 */
import { createLogger } from "@langwatch/observability";

import { buildClickHouse } from "./clickhouse-member.ts";
import { aesEncryption, loggedTelemetry, resolvedSecrets, systemClock } from "./config-members.ts";
import type { ProcessConfig } from "./config.ts";
import { buildPrisma, buildRedis, type BuiltMember } from "./datastore-members.ts";
import { buildEventing } from "./eventing-members.ts";
import { buildMail, skippedMail } from "./mail-member.ts";
import { type Encryption, MEMBER_NAMES, type MemberName, type ProcessMembers } from "./members.ts";
import { buildObjectStorage } from "./object-storage-member.ts";
import { redisCache, redisIdempotency, redisRateLimiter } from "./redis-members.ts";
import { buildClickHouseAdmin, buildDatabaseTarget } from "./store-targets.ts";
import { cachedTenantDirectory, prismaTenantDirectory } from "./tenant-directory.ts";

/**
 * A member this process was not configured to build. Thrown where the member is
 * read, so the caller that reached for it is on the stack and boot can name
 * both the module and the member (ADR-144 s2).
 */
export class MemberNotConfiguredError extends Error {
  constructor(
    readonly member: MemberName,
    remedy: string,
  ) {
    super(`This process has no "${member}" member: ${remedy}.`);
    this.name = "MemberNotConfiguredError";
  }
}

/** No key is a state, as main's lazy key was: only a use of the cipher refuses. */
function refusingEncryption(): Encryption {
  const refuse = (): never => {
    throw new MemberNotConfiguredError("encryption", "set the encryption key");
  };
  return { encrypt: refuse, decrypt: refuse };
}

/** A member handed in as an own property whose value is `undefined`. */
export class MemberSuppliedUndefinedError extends Error {
  constructor(readonly member: MemberName) {
    super(
      `The "${member}" member was handed in as undefined. Omit it to have this process ` +
        "build it, or pass a value; a misspelt override would otherwise become the real client.",
    );
    this.name = "MemberSuppliedUndefinedError";
  }
}

/**
 * Where a process's members come from. `order` is the construction order,
 * so a root that builds several reads them in an order where nothing opens
 * under something not yet open.
 */
export interface MemberSource<Members> {
  readonly order: readonly (keyof Members & string)[];
  /** Builds the member, or refuses naming it. Repeated reads answer once. */
  read<Name extends keyof Members & string>(name: Name): Members[Name];
  /** Closes every client this source opened, in reverse construction order. */
  close(): Promise<void>;
  /** The same close, so `await using members = createProcessMembers(...)` works. */
  [Symbol.asyncDispose](): Promise<void>;
}

export type ProcessMemberSource = MemberSource<ProcessMembers>;

/** What each member is built from, and what closing it means. */
type MemberBuilders = {
  readonly [Member in MemberName]: () => BuiltMember<ProcessMembers[Member]>;
};

export function createProcessMembers(options: {
  readonly config: ProcessConfig;
  /**
   * Members this caller built itself. One passed is used as it stands and is
   * never closed here, because the caller that made it owns it.
   */
  readonly members?: { readonly [Name in MemberName]?: ProcessMembers[Name] };
}): ProcessMemberSource {
  const { config } = options;
  const supplied = options.members ?? {};
  for (const member of MEMBER_NAMES) {
    if (Object.hasOwn(supplied, member) && supplied[member] === undefined) {
      throw new MemberSuppliedUndefinedError(member);
    }
  }

  const built = new Map<MemberName, unknown>();
  const opened: { member: MemberName; close: () => Promise<void> }[] = [];

  const read = <Name extends MemberName>(name: Name): ProcessMembers[Name] => {
    const handed = supplied[name];
    if (handed !== undefined) return handed;
    if (built.has(name)) return built.get(name) as ProcessMembers[Name];

    const result = builders[name]();
    built.set(name, result.value);
    if (result.close) opened.push({ member: name, close: result.close });
    return result.value as ProcessMembers[Name];
  };

  /**
   * The one directory both routed members place a tenant with. Built on
   * `prisma`, never a peer Api — Project's own live tier reads ClickHouse,
   * so member-to-Api-to-repositories-back-to-member is a cycle.
   */
  let directory: ReturnType<typeof cachedTenantDirectory> | undefined;
  const tenantDirectory = (): ReturnType<typeof cachedTenantDirectory> => {
    directory ??= cachedTenantDirectory(
      prismaTenantDirectory(read("prisma")),
      config.clickhouse?.maxTenantCacheEntries,
    );
    return directory;
  };

  const builders: MemberBuilders = {
    logger: () => ({ value: createLogger(config.processName) }),
    clock: () => ({ value: systemClock() }),
    secrets: () => ({ value: resolvedSecrets(config.secrets) }),
    encryption: () => {
      const key = config.encryptionKey.trim();
      if (!key) return { value: refusingEncryption() };
      return { value: aesEncryption(Buffer.from(key, "hex")) };
    },
    telemetry: () => ({ value: loggedTelemetry(read("logger")) }),

    prisma: () => {
      const database = config.database;
      if (!database?.url.trim()) {
        throw new MemberNotConfiguredError("prisma", "set DATABASE_URL");
      }
      return buildPrisma({ config: database, logger: read("logger") });
    },
    clickhouse: () => {
      const clickhouse = config.clickhouse;
      const configured =
        Boolean(clickhouse?.url?.trim()) || (clickhouse?.privateRoutes?.length ?? 0) > 0;
      if (!clickhouse || !configured) {
        throw new MemberNotConfiguredError(
          "clickhouse",
          "set CLICKHOUSE_URL or CLICKHOUSE_PRIVATE_ROUTES",
        );
      }
      return buildClickHouse({ config: clickhouse, directory: tenantDirectory() });
    },
    // "Not configured" is an answer here, not a refusal: LangWatchQL is optional (ADR-159).
    clickhouseAdmin: () => buildClickHouseAdmin(config.clickhouse),
    databaseTarget: () => buildDatabaseTarget(config.database),
    objectStorage: () => {
      if (!config.objectStorage) {
        throw new MemberNotConfiguredError(
          "objectStorage",
          "set STORED_OBJECTS_BACKEND and its bucket, container or root",
        );
      }
      return buildObjectStorage({
        config: config.objectStorage,
        directory: tenantDirectory(),
        clock: read("clock"),
      });
    },
    redis: () => {
      if (!config.redis) {
        throw new MemberNotConfiguredError("redis", "set REDIS_URL or REDIS_CLUSTER_ENDPOINTS");
      }
      return buildRedis(config.redis);
    },
    eventing: () => {
      const eventing = config.eventing;
      if (!eventing) {
        throw new MemberNotConfiguredError("eventing", "name this role's event store and queue");
      }
      // Read BEFORE the runtime is built, so the reverse close drains the
      // queue before the clients it dispatches and appends through go away.
      return buildEventing({
        config: eventing,
        processName: config.processName,
        ...(eventing.participation === undefined ? {} : { participation: eventing.participation }),
        ...(eventing.groupQueue === undefined ? {} : { redis: read("redis") }),
        ...(eventing.store.kind === "producer-only"
          ? {}
          : { eventLog: { prisma: read("prisma"), clickhouse: read("clickhouse") } }),
      });
    },
    // `off` is a state, not a refusal: the process boots and every send is
    // skipped with a log line naming it (ARCHITECTURE.md §6).
    mail: () =>
      config.mail.provider === "off" ? skippedMail(read("logger")) : buildMail(config.mail),

    // Redis-backed, so each inherits Redis's own refusal rather than repeating
    // it, and each is built over the ONE connection this process opened.
    cache: () => ({ value: redisCache(read("redis")) }),
    idempotency: () => ({ value: redisIdempotency(read("redis")) }),
    rateLimiter: () => ({ value: redisRateLimiter(read("redis"), config.rateLimit) }),
  };

  const source: ProcessMemberSource = {
    order: MEMBER_NAMES,
    read,
    async close(): Promise<void> {
      // Reverse construction order: eventing drains before the Redis its queue
      // sits on goes away, and a client is never closed under something still
      // holding it.
      for (const entry of [...opened].reverse()) await entry.close();
      opened.length = 0;
      built.clear();
      directory = undefined;
    },
    [Symbol.asyncDispose]: (): Promise<void> => source.close(),
  };

  return source;
}
