/**
 * What a process states about itself, and nothing more. Every value here is
 * data a boot seam has already parsed: a connection string, a bucket name, a
 * key. No member arrives pre-built, because a process that can hand one in is
 * a process that decides how it is built, and that decision is what this
 * package exists to hold.
 *
 * Two slices carry a collaborator rather than a string, and each is a seam the
 * process genuinely owns: eventing's event store and queue factory (which
 * datastore an event log lives in is the role's decision, not this package's),
 * and the process store a role that runs process managers supplies.
 */
import type { EventStore, ExecutionTarget, KillSwitch, ProcessStore } from "@langwatch/eventing";
import type { EventSourcingOptions } from "@langwatch/eventing";

/** Postgres, as one guarded client per process. */
export interface DatabaseConfig {
  /** `DATABASE_URL`. A blank string is an absent database, never a broken one. */
  readonly url: string;
  /** Development logs warnings as well as errors; everything else logs errors. */
  readonly logWarnings?: boolean;
}

/**
 * One organization whose data lives on its own ClickHouse server.
 *
 * The whole family is one variable, `CLICKHOUSE_PRIVATE_ROUTES`, holding this
 * array as JSON. It used to be a `CLICKHOUSE_URL__<label>__<organizationId>`
 * variable per customer, which no classifier could name in advance: every one
 * of them carried `user:password@host` past `packages/secrets/keys.json`, so
 * `haven env` printed it and the vault could not resolve it. One key is one
 * classified composite secret.
 */
export interface ClickHousePrivateRoute {
  readonly organizationId: string;
  /** With credentials in the URL, as the driver expects. */
  readonly url: string;
}

/** ClickHouse, as the endpoints this process may reach. */
export interface ClickHouseConfig {
  /** `CLICKHOUSE_URL` — the shared server. Absent where every tenant is private. */
  readonly url?: string;
  /** `CLICKHOUSE_PRIVATE_ROUTES` — one entry per organization on its own server. */
  readonly privateRoutes?: readonly ClickHousePrivateRoute[];
  /** Sockets the driver keeps open per endpoint. Absent uses the driver's default. */
  readonly maxOpenConnections?: number;
  /** How long one statement may take before the driver abandons it. */
  readonly requestTimeoutMs?: number;
  /** Statements allowed in flight at once. Absent means unbounded. */
  readonly maxConcurrentStatements?: number;
  /** Settings applied to every statement, before a statement's own. */
  readonly settings?: Readonly<Record<string, string>>;
  /** How many tenant-to-organization answers the router keeps. */
  readonly maxTenantCacheEntries?: number;
}

/** Redis, in the two shapes a deployment has: one URL, or a cluster. */
export interface RedisConfig {
  /** `REDIS_URL` — a `redis://` or `rediss://` connection string. */
  readonly url?: string;
  /** `REDIS_CLUSTER_ENDPOINTS` — comma-separated `host:port` pairs. */
  readonly clusterEndpoints?: string;
  /** `REDIS_DB_INDEX` — the worktree-isolation database index, 0-15. */
  readonly dbIndex?: string | number;
}

/**
 * Event sourcing, which is a runtime rather than a client: this package builds
 * the runtime, and the process states which log it appends to and which queue
 * it dispatches through, because those differ by role.
 */
export interface EventingConfig {
  /** Where events are appended and read. A producer supplies a producer-only store. */
  readonly eventStore: EventStore;
  /** How a command reaches its consumer. Absent runs projections inline. */
  readonly queueFactory?: EventSourcingOptions["queueFactory"];
  /** Whether this role claims the queue, or only produces onto it. */
  readonly consumersEnabled: boolean;
  /** Which tier a command records as its origin. */
  readonly executionTarget: ExecutionTarget;
  /** Whether this role runs the process managers its pipelines declare. */
  readonly processManagerMode?: "run" | "producer-only";
  /** Durable inbox, state, outbox, leases and wakes, on a role that runs them. */
  readonly processStore?: ProcessStore;
  /** Per-tenant operator stop for every component the pipelines mount. */
  readonly killSwitch?: KillSwitch;
}

/** Where one account's objects are written, and under whose credentials. */
export interface ObjectStorageAccount {
  readonly bucket: string;
  readonly region?: string;
  /** A non-AWS endpoint (MinIO, a dev container). Absent uses AWS itself. */
  readonly endpoint?: string;
  /** Absent leaves the SDK on the deployment's own credential chain. */
  readonly credentials?: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
  /** MinIO and most S3-compatible endpoints need the bucket in the path. */
  readonly forcePathStyle?: boolean;
}

/** One organization writing to its own S3 account rather than the shared one. */
export interface ObjectStoragePrivateAccount extends ObjectStorageAccount {
  readonly organizationId: string;
}

/** Blob storage: the shared account, and the organizations that bring their own. */
export interface ObjectStorageConfig extends ObjectStorageAccount {
  readonly privateAccounts?: readonly ObjectStoragePrivateAccount[];
}

/** `HTTPS_PROXY` and friends, already parsed, for a gateway reached through one. */
export interface OutboundProxyConfig {
  readonly httpsProxy?: string;
  readonly httpProxy?: string;
  readonly noProxy?: string;
}

/** `MAIL_PROVIDER`. `off` is a statement, not an absence: it says this deployment sends nothing. */
export type MailProvider = "smtp" | "ses" | "resend" | "off";

/**
 * Which gateway this process sends through, with that gateway's own leaves
 * required and no other gateway's readable.
 *
 * The discriminant is the whole config: a deployment on SES cannot half-declare
 * SMTP, and one on SMTP with no host does not compile here and is refused at
 * parse by the boot seam's `Config.group`, rather than at the first send weeks
 * later. `off` carries no leaves at all, and reading the `mail` member on an
 * `off` process refuses by name at boot rather than dropping messages quietly.
 */
export type MailConfig =
  | Readonly<{ readonly provider: "off" }>
  | Readonly<{
      readonly provider: "smtp";
      readonly defaultFrom: string;
      readonly host: string;
      readonly port: number;
      readonly user: string;
      readonly password: string;
      /** TLS on connect, rather than STARTTLS. Absent leaves the transport's default. */
      readonly secure?: boolean;
      readonly outboundProxy?: OutboundProxyConfig;
    }>
  | Readonly<{
      readonly provider: "ses";
      readonly defaultFrom: string;
      readonly region: string;
      /** A non-AWS endpoint, for a local stand-in. Absent uses SES itself. */
      readonly endpoint?: string;
      readonly outboundProxy?: OutboundProxyConfig;
    }>
  | Readonly<{
      readonly provider: "resend";
      readonly defaultFrom: string;
      readonly apiKey: string;
      readonly outboundProxy?: OutboundProxyConfig;
    }>;

/** What the members are built from: parsed config, and nothing read from the shell. */
export interface ProcessConfig {
  /** Names the process in every log line and every metric these members write. */
  readonly processName: string;
  /** The 32-byte key stored values are encrypted under, hex-encoded. */
  readonly encryptionKey: string;
  /** Every secret this process resolved at boot (ADR-132). */
  readonly secrets: Readonly<Record<string, string>>;
  /** The default allowance a rate-limited route counts against. */
  readonly rateLimit: Readonly<{ requests: number; seconds: number }>;
  /**
   * The datastores this deployment named. A slice left out is a member this
   * process cannot build, and asking for it refuses by name rather than
   * answering with something emptier that looks healthy.
   */
  readonly database?: DatabaseConfig;
  readonly clickhouse?: ClickHouseConfig;
  readonly redis?: RedisConfig;
  readonly eventing?: EventingConfig;
  readonly objectStorage?: ObjectStorageConfig;
  /**
   * Which mail gateway this deployment sends through. Required, because
   * `MAIL_PROVIDER=off` is how a deployment says it sends nothing: an absent
   * slice would make a lost variable read as that same statement.
   */
  readonly mail: MailConfig;
}
