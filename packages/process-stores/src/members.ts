/**
 * The fourteen members a process hands its modules. Closed on purpose — an
 * open list is the optional collaborator production forgets to supply.
 * `audit` is not on it, since that peer is resolved via `withAudit`.
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
 * Which project's object this is. Every call names one, since the member
 * resolves bucket, endpoint and credentials from it — no client can be held
 * and reused against the wrong project.
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

/**
 * Rate limiting. The framework owns the key, so the limiter only counts. A
 * caller past its allowance names its own window; the limiter's constructed
 * one is the default a caller that names none counts against.
 */
export interface RateLimiter {
  check(key: string, limit?: { requests: number; seconds: number }): Promise<RateLimitDecision>;
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
 * What the process hands a module: one record, fourteen keys. `clickhouse`
 * and `objectStorage` are each ONE client that routes internally, so "every
 * statement names its tenant" is structural, not a rule to remember.
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
 * Every member name, in construction order - load-bearing, and asserted by
 * this package's tests: `prisma` precedes `clickhouse`/`objectStorage` (both
 * route through its directory read), `redis` precedes what's built over it.
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
 * What a module says it reads: `static readonly reads = reads("clock", "logger")`.
 * The tuple is the type's source too, so a wrong name fails on the line
 * the author wrote.
 */
export function reads<const Names extends readonly MemberName[]>(...names: Names): Names {
  return names;
}

/** The record a module is handed for the names it declared with {@link reads}. */
export type MembersRead<Names extends readonly MemberName[]> = {
  readonly [Name in Names[number]]: ProcessMembers[Name];
};
