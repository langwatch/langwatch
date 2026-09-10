/**
 * The fourteen members a process hands its modules, and the vocabulary of each.
 *
 * The list is closed on purpose: an open one is the optional collaborator
 * production forgets to supply. A module that wants something new argues for a
 * member, derives it inside its own App, or takes a peer Api — a peer never
 * travels through here, which is why `audit` is not on the list: the real sink
 * is the audit-log module's App, resolved as a peer by the transport runtime
 * that declares `withAudit`.
 *
 * Nothing in this file opens a socket or names a vendor SDK, so a module that
 * imports `reads` to say what it reads pulls in no client library. The
 * construction lives behind `@langwatch/infrastructure/process`.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";

/** Now, read from one place, so a test moves time without touching a module. */
export interface Clock {
  now(): Date;
}

/** Symmetric encryption of a stored value, keyed by the process. */
export interface Encryption {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** The resolved secrets this process was started with (ADR-132). */
export interface SecretResolver {
  /** The value, or a refusal naming the key. */
  read(key: string): string;
  /** The value, or undefined where the process was started without it. */
  find(key: string): string | undefined;
}

/** One stored object, as every module that keeps a blob reads and writes it. */
export interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string | undefined;
}

/**
 * Which project's object this is. Every call names one, because the member
 * resolves the bucket, the endpoint and the credentials from it: a caller
 * cannot obtain a client that addresses no project, and therefore cannot
 * address another project's bucket by holding on to the wrong one.
 */
export interface StoredObjectAddress {
  readonly projectId: string;
  readonly key: string;
}

/** Blob storage, routed to the project's own account where it has one. */
export interface ObjectStorage {
  put(at: StoredObjectAddress, body: Uint8Array, contentType?: string): Promise<void>;
  find(at: StoredObjectAddress): Promise<StoredObject | undefined>;
  remove(at: StoredObjectAddress): Promise<void>;
}

/** One message, already rendered, as the mail member sends it. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly from?: string;
}

/** Transactional mail. Rendering belongs to @langwatch/mail, sending here. */
export interface Mail {
  send(message: MailMessage): Promise<void>;
}

/**
 * Response cache. The same shape the REST runtime in packages/api declares, so
 * it reads this member directly.
 */
export interface Cache {
  find(key: string): Promise<Uint8Array | undefined>;
  set(key: string, tag: string, body: Uint8Array, ttlSeconds: number): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
}

/** What one rate-limit decision says. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

/** Rate limiting. The framework owns the key, so the limiter only counts. */
export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

/** Remembers a key for the window in which a repeat must not act twice. */
export interface IdempotencyStore {
  /** True the first time this key is seen inside the window, false after. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

/** Counters and observations a module reports without naming an exporter. */
export interface Telemetry {
  count(name: string, value?: number, attributes?: Readonly<Record<string, string>>): void;
  observe(name: string, value: number, attributes?: Readonly<Record<string, string>>): void;
}

/**
 * What the process hands a module, one record, fourteen keys.
 *
 * `clickhouse` and `objectStorage` are each ONE client that routes internally:
 * neither is a resolver a caller calls with a tenant or a project id, so
 * "every statement names its tenant" and "every object names its project" are
 * structural rather than rules a reader has to remember.
 */
export interface ProcessMembers {
  readonly prisma: PrismaClient;
  readonly clickhouse: ClickHouseQueryClient;
  readonly redis: RedisConnection;
  readonly eventing: EventSourcing;
  readonly objectStorage: ObjectStorage;
  readonly mail: Mail;
  readonly clock: Clock;
  readonly encryption: Encryption;
  readonly secrets: SecretResolver;
  readonly cache: Cache;
  readonly rateLimiter: RateLimiter;
  readonly idempotency: IdempotencyStore;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
}

/** One member's name. A misspelling is a compile error where it is written. */
export type MemberName = keyof ProcessMembers;

/**
 * Every member name, in construction order.
 *
 * The order is load-bearing and is asserted by this package's tests: `prisma`
 * comes before `clickhouse` and `objectStorage` because both route on a
 * directory read through it, and `redis` comes before the three members built
 * over it, so no member is ever constructed under something not yet open.
 */
export const MEMBER_NAMES = [
  "logger",
  "clock",
  "secrets",
  "encryption",
  "telemetry",
  "prisma",
  "clickhouse",
  "objectStorage",
  "redis",
  "cache",
  "idempotency",
  "rateLimiter",
  "eventing",
  "mail",
] as const satisfies readonly MemberName[];

/**
 * What a module says it reads, in one line, on its App:
 *
 * ```ts
 * static readonly reads = reads("clock", "logger");
 * ```
 *
 * The tuple is the type's source as well as boot's, so there is no interface
 * to keep in agreement with a list, and a wrong name fails as
 * `'"clcok"' is not assignable to 'MemberName'` on the line the author wrote.
 */
export function reads<const Names extends readonly MemberName[]>(...names: Names): Names {
  return names;
}

/** The record a module is handed for the names it declared with {@link reads}. */
export type MembersRead<Names extends readonly MemberName[]> = {
  readonly [Name in Names[number]]: ProcessMembers[Name];
};
