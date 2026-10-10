/**
 * Built EAGERLY at boot, not re-derived per use — two constructions of the
 * same client would split one process into duplicate caches and dedup
 * keyspaces. An unconfigured member REFUSES BY NAME, never a silent omission.
 */
import type { EventReadSeat } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { OperatorReadMint } from "@langwatch/prisma-client";

import { buildClickHouse } from "./clickhouse-member.ts";
import {
  aesEncryption,
  loggedTelemetry,
  resolvedSecrets,
  rotatingEncryption,
  systemClock,
} from "./config-members.ts";
import type { ProcessConfig } from "./config.ts";
import { buildPrisma, buildRedis, type BuiltMember } from "./datastore-members.ts";
import { buildEventing } from "./eventing-members.ts";
import { groupQueueStorage } from "./group-queue-storage.ts";
import {
  type Encryption,
  STORE_CLIENT_NAMES,
  type StoreClientName,
  type StoreClients,
} from "./members.ts";
import { buildObjectStorage } from "./object-storage-member.ts";
import { redisCache, redisIdempotency, redisRateLimiter } from "./redis-members.ts";
import { buildClickHouseAdmin, buildDatabaseTarget } from "./store-targets.ts";
import {
  cachedTenantDirectory,
  prismaTenantDirectory,
  privateTenantListing,
} from "./tenant-directory.ts";

/**
 * A member this process was not configured to build. Thrown where the member is
 * read, so the caller that reached for it is on the stack and boot can name
 * both the module and the member.
 */
export class MemberNotConfiguredError extends Error {
  constructor(
    readonly member: StoreClientName,
    remedy: string,
  ) {
    super(`This process has no "${member}" member: ${remedy}.`);
    this.name = "MemberNotConfiguredError";
  }
}

/** An opened store that did not answer its readiness query, named by member. */
export class StoreNotAnsweringError extends Error {
  readonly code = "store_not_answering";

  constructor(
    readonly member: string,
    cause: unknown,
  ) {
    super(`The "${member}" store did not answer its readiness query.`, { cause });
    this.name = "StoreNotAnsweringError";
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
  constructor(readonly member: StoreClientName) {
    super(
      `The "${member}" member was handed in as undefined. Omit it to have this process ` +
        "build it, or pass a value; a misspelt override would otherwise become the real client.",
    );
    this.name = "MemberSuppliedUndefinedError";
  }
}

/**
 * Where a process's store clients come from. `order` is the construction order,
 * so a root that builds several reads them in an order where nothing opens
 * under something not yet open.
 */
export interface ProcessMemberSource {
  /** The store tier these clients belong to; boot selects every registry from it (§7). */
  readonly tier?: "live" | "memory";
  readonly order: readonly StoreClientName[];
  /** Builds the client, or refuses naming it. Repeated reads answer once. */
  read<Name extends StoreClientName>(name: Name): StoreClients[Name];
  /**
   * Resolves once every client this source opened answers one cheap query; rejects naming
   * the first that does not. Spec: specs/server/process-readiness.feature.
   */
  answer?(): Promise<void>;
  /** Closes every client this source opened, in reverse construction order. */
  close(): Promise<void>;
  /** The same close, so `await using members = buildProcessStores(...).members` works. */
  [Symbol.asyncDispose](): Promise<void>;
}

/** Reads a member through the one source, building it on first read. */
type ReadMember = <Name extends StoreClientName>(name: Name) => StoreClients[Name];

type TenantDirectory = ReturnType<typeof cachedTenantDirectory>;

/** No key is a state, not a refusal: only a use of the cipher refuses. */
function encryptionMember(config: ProcessConfig): Encryption {
  const key = config.encryptionKey.trim();
  if (!key) return refusingEncryption();

  const current = aesEncryption(Buffer.from(key, "hex"));
  const previousKey = config.previousEncryptionKey?.trim();
  if (!previousKey) return current;

  return rotatingEncryption({ current, previous: previousEncryption(previousKey) });
}

/** A malformed previous key refuses as a malformed current one does, under its own name. */
function previousEncryption(key: string): Encryption {
  try {
    return aesEncryption(Buffer.from(key, "hex"));
  } catch (error) {
    throw new Error(
      `CREDENTIALS_SECRET_PREVIOUS is not a usable key. ${error instanceof Error ? error.message : ""}`,
      { cause: error },
    );
  }
}

function prismaMember({
  config,
  read,
}: {
  config: ProcessConfig;
  read: ReadMember;
}): ReturnType<typeof buildPrisma> {
  const database = config.database;
  if (!database?.url.trim()) {
    throw new MemberNotConfiguredError("prisma", "set DATABASE_URL");
  }
  return buildPrisma({ config: database, logger: read("logger") });
}

function clickhouseConfigured(config: ProcessConfig): boolean {
  const clickhouse = config.clickhouse;
  return Boolean(clickhouse?.url?.trim()) || (clickhouse?.privateRoutes?.length ?? 0) > 0;
}

function clickhouseMember({
  config,
  tenantDirectory,
}: {
  config: ProcessConfig;
  tenantDirectory: () => TenantDirectory;
}): BuiltMember<StoreClients["clickhouse"]> {
  const clickhouse = config.clickhouse;
  if (!clickhouse || !clickhouseConfigured(config)) {
    throw new MemberNotConfiguredError(
      "clickhouse",
      "set CLICKHOUSE_URL or a CLICKHOUSE_URL__<label>__<orgId> route",
    );
  }
  return buildClickHouse({ config: clickhouse, directory: tenantDirectory() });
}

function objectStorageMember({
  config,
  read,
  tenantDirectory,
}: {
  config: ProcessConfig;
  read: ReadMember;
  tenantDirectory: () => TenantDirectory;
}): BuiltMember<StoreClients["objectStorage"]> {
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
}

/** An override handed in as `undefined` is a misspelling, never a request to build. */
function refuseUndefinedMembers(supplied: {
  readonly [Name in StoreClientName]?: StoreClients[Name];
}): void {
  for (const member of STORE_CLIENT_NAMES) {
    if (Object.hasOwn(supplied, member) && supplied[member] === undefined) {
      throw new MemberSuppliedUndefinedError(member);
    }
  }
}

function eventingMember({
  config,
  read,
}: {
  config: ProcessConfig;
  read: ReadMember;
}): BuiltMember<StoreClients["eventing"]> {
  const eventing = config.eventing;
  if (!eventing) {
    throw new MemberNotConfiguredError("eventing", "name this role's event store and queue");
  }
  // Read BEFORE the runtime is built, so the reverse close drains the
  // queue before the clients it dispatches and appends through go away.
  const prisma = read("prisma");
  const privateTenants = privateTenantListing({
    prisma,
    organizationIds: (config.clickhouse?.privateRoutes ?? []).map((r) => r.organizationId),
  });
  // Main offloaded every role's oversized payloads through its storage registry.
  const storage =
    eventing.groupQueue === undefined ||
    eventing.groupQueue.storage !== undefined ||
    !config.objectStorage
      ? undefined
      : groupQueueStorage({ storage: read("objectStorage") });
  return buildEventing({
    config:
      storage === undefined
        ? eventing
        : { ...eventing, groupQueue: { ...eventing.groupQueue, storage } },
    processName: config.processName,
    prisma,
    ...(privateTenants === undefined ? {} : { privateTenants }),
    ...(eventing.participation === undefined ? {} : { participation: eventing.participation }),
    ...(eventing.groupQueue === undefined ? {} : { redis: read("redis") }),
    ...(eventing.store.kind === "producer-only" && !clickhouseConfigured(config)
      ? {}
      : { eventLog: { clickhouse: read("clickhouse") } }),
  });
}

/** A role whose eventing reads no event log still hands a seat: only a read through it refuses. */
function refusingEventReadSeat(): EventReadSeat {
  const refuse = () =>
    Promise.reject(
      new MemberNotConfiguredError(
        "eventReadSeat",
        "give this role's eventing the event log (set CLICKHOUSE_URL)",
      ),
    );
  return { getEvent: refuse, getEvents: refuse };
}

/** Eventing's seat where this role's eventing reads the event log; a refusing one otherwise. */
function eventReadSeatMember({
  config,
  supplied,
  read,
}: {
  config: ProcessConfig;
  supplied: NonNullable<BuildProcessStoresOptions["members"]>;
  read: ReadMember;
}): BuiltMember<EventReadSeat> {
  const eventingAvailable = config.eventing !== undefined || supplied.eventing !== undefined;
  const seat = eventingAvailable ? read("eventing").eventReadSeat : undefined;
  return { value: seat ?? refusingEventReadSeat() };
}

/** What each member is built from, and what closing it means. */
type MemberBuilders = {
  readonly [Member in StoreClientName]: () => BuiltMember<StoreClients[Member]>;
};

type BuildProcessStoresOptions = {
  readonly config: ProcessConfig;
  /**
   * Members this caller built itself. One passed is used as it stands and is
   * never closed here, because the caller that made it owns it.
   */
  readonly members?: { readonly [Name in StoreClientName]?: StoreClients[Name] };
};

/** The opened members, plus the operator-read mint only the process root may hold (§7). */
export type ProcessStores = Readonly<{
  members: ProcessMemberSource;
  operatorReads: OperatorReadMint;
}>;

export function buildProcessStores(options: BuildProcessStoresOptions): ProcessStores {
  const { config } = options;
  const supplied = options.members ?? {};
  refuseUndefinedMembers(supplied);

  const built = new Map<StoreClientName, unknown>();
  const opened: { member: StoreClientName; close: () => Promise<void> }[] = [];
  const answering: { member: string; answer: () => Promise<void> }[] = [];

  const read = <Name extends StoreClientName>(name: Name): StoreClients[Name] => {
    const handed = supplied[name];
    if (handed !== undefined) return handed;
    if (built.has(name)) return built.get(name) as StoreClients[Name];

    const result = builders[name]();
    built.set(name, result.value);
    if (result.close) opened.push({ member: name, close: result.close });
    if (result.answer) answering.push({ member: name, answer: result.answer });
    return result.value as StoreClients[Name];
  };

  /**
   * The one directory both routed members place a tenant with. Built on
   * `prisma`, never a peer Api — Project's own live tier reads ClickHouse,
   * so member-to-Api-to-repositories-back-to-member is a cycle.
   */
  let directory: TenantDirectory | undefined;
  const tenantDirectory = (): TenantDirectory => {
    directory ??= cachedTenantDirectory(
      prismaTenantDirectory(read("prisma")),
      config.clickhouse?.maxTenantCacheEntries,
    );
    return directory;
  };

  let prismaOperatorReads: OperatorReadMint | undefined;
  const operatorReads: OperatorReadMint = (input) => {
    read("prisma");
    if (!prismaOperatorReads) {
      throw new MemberNotConfiguredError(
        "prisma",
        "open it here, not hand it in, to mint operator reads",
      );
    }
    return prismaOperatorReads(input);
  };

  const builders: MemberBuilders = {
    logger: () => ({ value: createLogger(config.processName) }),
    clock: () => ({ value: systemClock() }),
    secrets: () => ({ value: resolvedSecrets(config.secrets) }),
    encryption: () => ({ value: encryptionMember(config) }),
    telemetry: () => ({ value: loggedTelemetry(read("logger")) }),

    prisma: () => {
      const built = prismaMember({ config, read });
      prismaOperatorReads = built.operatorReads;
      return built;
    },
    clickhouse: () => clickhouseMember({ config, tenantDirectory }),
    // "Not configured" is an answer here, not a refusal: LangWatchQL is optional (ADR-159).
    clickhouseAdmin: () => buildClickHouseAdmin(config.clickhouse),
    databaseTarget: () => buildDatabaseTarget(config.database),
    objectStorage: () => objectStorageMember({ config, read, tenantDirectory }),
    redis: () => {
      if (!config.redis) {
        throw new MemberNotConfiguredError("redis", "set REDIS_URL or REDIS_CLUSTER_ENDPOINTS");
      }
      return buildRedis(config.redis);
    },
    eventing: () => eventingMember({ config, read }),
    eventReadSeat: () => eventReadSeatMember({ config, supplied, read }),

    // Redis-backed, so each inherits Redis's own refusal rather than repeating
    // it, and each is built over the ONE connection this process opened.
    cache: () => ({ value: redisCache(read("redis")) }),
    idempotency: () => ({ value: redisIdempotency(read("redis")) }),
    rateLimiter: () => ({ value: redisRateLimiter(read("redis"), config.rateLimit) }),
  };

  const source: ProcessMemberSource = {
    // Real clients: the one place the live tier is stated, so boot never assumes it.
    tier: "live",
    order: STORE_CLIENT_NAMES,
    read,
    async answer(): Promise<void> {
      await Promise.all(
        answering.map(({ member, answer }) =>
          answer().catch((error: unknown) => {
            throw new StoreNotAnsweringError(member, error);
          }),
        ),
      );
    },
    async close(): Promise<void> {
      // Reverse construction order: eventing drains before the Redis its queue
      // sits on goes away, and a client is never closed under something still
      // holding it.
      for (const entry of [...opened].reverse()) await entry.close();
      opened.length = 0;
      answering.length = 0;
      built.clear();
      directory = undefined;
    },
    [Symbol.asyncDispose]: (): Promise<void> => source.close(),
  };

  return { members: source, operatorReads };
}

/** Host before the runtime so its stores close after the runtime stops; ready once they answer. */
export function hostedStores(source: ProcessMemberSource) {
  return {
    name: "process stores",
    stop: () => source.close(),
    ...(source.answer === undefined
      ? {}
      : {
          ready: async () => {
            await source.answer?.();
          },
        }),
  };
}
