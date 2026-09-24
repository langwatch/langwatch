/**
 * The sixteen members a process hands its modules. Closed on purpose — an
 * open list is the optional collaborator production forgets to supply.
 * `audit` is not on it, since that peer is resolved via `withAudit`.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { EventSourcing } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import type { Instant } from "@langwatch/time";

/** Now, read from one place, so a test moves time without touching a module. */
export interface Clock {
  now(): Instant;
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

/**
 * Which project's object this is. Every call names one, since the member
 * resolves bucket, endpoint and credentials from it — no client can be held
 * and reused against the wrong project.
 */
export interface StoredObjectAddress {
  readonly projectId: string;
  readonly key: string;
  /** Where the object was recorded: read, digest and remove go there; writes ignore it. */
  readonly location?: ObjectStorageDestination;
}

/** What a writer states about a body before sending it. */
export interface ObjectBodyFacts {
  readonly byteLength: number;
  readonly contentType: string;
}

/** An object's size and lowercase-hex SHA-256, measured over its bytes as they streamed. */
export interface ObjectDigest {
  readonly byteLength: number;
  readonly sha256: string;
}

/** What a writer states about an upload a client will PUT, and when its URL lapses. */
export type UploadFacts = ObjectBodyFacts & Readonly<{ expiresAt: Instant }>;
/** When a signed download URL lapses. */
export type DownloadFacts = Readonly<{ expiresAt: Instant }>;

/** Where a client PUTs an upload: a URL the backend signed, or the process's own signed route. */
export type SignedObjectUpload =
  | Readonly<{ kind: "direct"; url: string; headers: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "through-process" }>;

/** Where one project's objects live. */
export type ObjectStorageDestination =
  | Readonly<{ kind: "s3"; bucket: string }>
  | Readonly<{ kind: "azure"; accountName: string; container: string }>
  | Readonly<{ kind: "file"; root: string }>
  | Readonly<{ kind: "memory" }>;

/**
 * Object storage over S3, Azure Blob or the filesystem, routed per project
 * (ADR-158). Every body is a stream and every digest is taken over one.
 */
export interface ObjectStorage {
  /** Counts and hashes while writing; refuses a body longer or shorter than declared. */
  write(
    at: StoredObjectAddress,
    body: AsyncIterable<Uint8Array>,
    facts: ObjectBodyFacts,
  ): Promise<ObjectDigest>;
  /** The object's bytes; an absent object refuses with StoredObjectNotFoundError. */
  read(at: StoredObjectAddress): Promise<AsyncIterable<Uint8Array>>;
  /** The backend's SHA-256 where it holds one, else the object streamed back through the hash. */
  digest(at: StoredObjectAddress): Promise<ObjectDigest>;
  /** Removes the object; an absent one is already removed. */
  remove(at: StoredObjectAddress): Promise<void>;
  signUpload(at: StoredObjectAddress, facts: UploadFacts): Promise<SignedObjectUpload>;
  /** A GET URL a remote reader fetches the object from; a backend with no URL to sign refuses. */
  signDownload(at: StoredObjectAddress, facts: DownloadFacts): Promise<string>;
  destination(projectId: string): Promise<ObjectStorageDestination>;
  /** Resolves when the project's destination answers with its credentials, and throws otherwise. */
  probe(projectId: string): Promise<void>;
}

/** One message, already rendered, as the mail member sends it. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly from?: string;
  /** Delivered without appearing in the headers, so recipients cannot see each other. */
  readonly bcc?: readonly string[];
  /** Extra MIME headers, such as `List-Unsubscribe`. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Transactional mail. Rendering belongs to @langwatch/mail, sending here. */
export interface Mail {
  send(message: MailMessage): Promise<void>;
  /** The address a send without its own `from` goes out from. */
  defaultFrom(): string;
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
 * The shared ClickHouse server's administrative seam, for the LangWatchQL access model
 * (ADR-159): the credential-free target, and statements that name no tenant. The URL it
 * was built from never leaves the stores' construction closure (ADR-132).
 */
export type ClickHouseAdmin =
  | Readonly<{ configured: false }>
  | Readonly<{
      configured: true;
      /** The server origin (no credentials, path or query) and the database its path named. */
      target: Readonly<{ url: string; database: string }>;
      statements: ClickHouseAdminStatements;
    }>;

/** Untenanted statements on the shared server: DDL, `system.*` reads, the key-map writes. */
export interface ClickHouseAdminStatements {
  command(statement: string): Promise<void>;
  rows(sql: string, params?: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>[]>;
  insert(input: {
    table: string;
    rows: readonly Readonly<Record<string, unknown>>[];
    settings?: Readonly<Record<string, string | number>>;
  }): Promise<void>;
}

/** The PostgreSQL endpoint `DATABASE_URL` names, without its credentials (ADR-159). */
export type DatabaseTarget =
  | Readonly<{ configured: false }>
  | Readonly<{
      configured: true;
      host: string;
      port: number;
      database: string;
      /** Prisma's `?schema=`, `public` when absent. */
      schema: string;
      /** Prisma's `?connection_limit=`, where the URL names one. */
      connectionLimit?: number;
    }>;

/**
 * What the process hands a module: one record, sixteen keys. `clickhouse`
 * and `objectStorage` are each ONE client that routes internally, so "every
 * statement names its tenant" is structural, not a rule to remember.
 */
export interface ProcessMembers {
  readonly prisma: PrismaClient;
  readonly clickhouse: ClickHouseQueryClient;
  readonly clickhouseAdmin: ClickHouseAdmin;
  readonly databaseTarget: DatabaseTarget;
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
  "databaseTarget",
  "clickhouse",
  "clickhouseAdmin",
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
