/**
 * What a process states about itself: every value here is data a boot seam
 * already parsed, never a pre-built collaborator. Two exceptions carry one:
 * eventing's store/queue factory and the process store a process-manager role supplies.
 */
import type { ExecutionTarget, KillSwitch } from "@langwatch/eventing";
import type { GroupQueuePolicy, GroupQueueStorage } from "@langwatch/group-queue";
import type { EventingParticipation } from "@langwatch/kernel";

/** Postgres, as one guarded client per process. */
export interface DatabaseConfig {
  /** `DATABASE_URL`. A blank string is an absent database, never a broken one. */
  readonly url: string;
  /** Development logs warnings as well as errors; everything else logs errors. */
  readonly logWarnings?: boolean;
}

/**
 * One organization on its own ClickHouse server. The whole family is one
 * variable, `CLICKHOUSE_PRIVATE_ROUTES` (JSON array) — it used to be a
 * per-customer var no classifier could name, leaking it past `haven env`.
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
 * The queue a role dispatches through, built over the ONE Redis connection
 * this process opened — never a second one, so a drain cannot outlive the
 * connection it drains through.
 */
export interface EventingGroupQueueConfig {
  /** Retry, lease and concurrency shape. Absent uses the queue's own. */
  readonly policy?: GroupQueuePolicy;
  /** Where an oversized payload's body is offloaded. Absent keeps it inline. */
  readonly storage?: GroupQueueStorage;
}

/**
 * Where events are appended and read, as the role states it: a role that only
 * sends refuses every read by name, and a role that drains reads the event log
 * this deployment's ClickHouse holds, leasing its process state in Postgres.
 */
export type EventingStoreConfig =
  | Readonly<{ readonly kind: "producer-only" }>
  | Readonly<{
      readonly kind: "event-log";
      /** The fallback retention for rows whose tenant states none, in days. */
      readonly defaultRetentionDays: number;
    }>;

/**
 * Event sourcing, which is a runtime rather than a client: this package builds
 * the runtime, and the process states which log it appends to and which queue
 * it dispatches through, because those differ by role.
 */
export interface EventingConfig {
  /** Which half of event sourcing this role runs, and over what. */
  readonly store: EventingStoreConfig;
  /** How a command reaches its consumer. Absent runs projections inline. */
  readonly groupQueue?: EventingGroupQueueConfig;
  /** Whether this role claims the queue, or only produces onto it. */
  readonly consumersEnabled: boolean;
  /** Which tier a command records as its origin. */
  readonly executionTarget: ExecutionTarget;
  /** Whether this role runs the process managers its pipelines declare. */
  readonly processManagerMode?: "run" | "producer-only";
  /** Overrides the half this process's role would otherwise install. */
  readonly participation?: EventingParticipation;
  /** Per-tenant operator stop for every component the pipelines mount. */
  readonly killSwitch?: KillSwitch;
}

/** Where one S3 account's objects are written, and under whose credentials. */
export interface ObjectStorageAccount {
  readonly bucket: string;
  /** Absent leaves AWS endpoints on the SDK's own chain and names `auto` for any other. */
  readonly region?: string;
  /** A non-AWS endpoint (MinIO, R2, a dev container). Absent uses AWS itself. */
  readonly endpoint?: string;
  /** Absent leaves the SDK on the deployment's own credential chain. */
  readonly credentials?: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
  /** Absent keeps the bucket in the path, which every S3-compatible endpoint accepts. */
  readonly forcePathStyle?: boolean;
}

/** One organization writing to its own S3 account rather than the shared backend. */
export interface ObjectStoragePrivateAccount extends ObjectStorageAccount {
  readonly organizationId: string;
}

/** The identity a Kubernetes workload-identity webhook injected, as the boot seam read it. */
export interface ObjectStorageAzureIdentity {
  readonly tenantId?: string;
  readonly clientId?: string;
  readonly federatedTokenFile?: string;
}

/** The `AZURE_BLOB_*` block as configured; the member validates it at build and refuses by name. */
export interface ObjectStorageAzureConfig {
  readonly authMode?: string;
  readonly accountName?: string;
  /** `AZURE_BLOB_ACCOUNT_KEY`, resolved through the secrets chain, never a config leaf. */
  readonly accountKey?: string;
  readonly container?: string;
  readonly endpoint?: string;
  readonly authorityHost?: string;
  readonly tokenAudience?: string;
  /** Plaintext token endpoints for emulator tests; the boot seam never sets it in production. */
  readonly allowInsecureTokenEndpointForTests?: boolean;
  readonly identity?: ObjectStorageAzureIdentity;
}

/**
 * Object storage: the shared backend `STORED_OBJECTS_BACKEND` selects, and
 * the organizations that bring their own S3 account.
 */
export type ObjectStorageConfig = (
  | Readonly<{ backend: "s3"; s3: ObjectStorageAccount }>
  | Readonly<{ backend: "azure"; azure: ObjectStorageAzureConfig }>
  | Readonly<{ backend: "file"; root: string }>
) &
  Readonly<{ privateAccounts?: readonly ObjectStoragePrivateAccount[] }>;

/** `HTTPS_PROXY` and friends, already parsed, for a gateway reached through one. */
export interface OutboundProxyConfig {
  readonly httpsProxy?: string;
  readonly httpProxy?: string;
  readonly noProxy?: string;
}

/** `MAIL_PROVIDER`. `off` is a statement, not an absence: it says this deployment sends nothing. */
export type MailProvider = "smtp" | "ses" | "resend" | "off";

/**
 * Which gateway this process sends through, with only that gateway's own
 * fields present. A bad shape is refused at parse by the boot seam, not at
 * the first send weeks later, and `off` builds a member that skips every send.
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
