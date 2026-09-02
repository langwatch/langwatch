import {
  assertObservabilityDoesNotSelfIngest,
  Config,
  environmentBooleanSchema,
  parseDataplaneS3RoutingTable,
  resolveTelemetryConfiguration,
  RuntimeConfig,
  portSchema,
  type ConfigValue,
} from "@langwatch/config";
import {
  createLogger,
  loggerConfigurationFrom,
  type Logger,
  type LoggerConfiguration,
} from "@langwatch/observability";
import {
  parseRoutingTable,
  poolSizingFromEnv,
  type PoolSizingInput,
} from "@langwatch/clickhouse-client";
import {
  otlpMetricsExportOptionsFrom,
  type OtlpMetricsExportOptions,
  type ProcessObservabilityOptions,
} from "@langwatch/observability/node";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import { resolveFeatureFlagConfig, type FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
import type {
  AzureBlobCredentialsConfig,
  AzureInjectedIdentity,
} from "@langwatch/stored-object-server";
import { z } from "zod";

const optionalEnvironmentString = z.string().optional();

/**
 * Built on demand rather than at module load: this module runs before the
 * process has configured its logging, so a logger held in a constant would be
 * the one that was created first rather than the one the deployment asked for.
 */
const configLogger = (): Pick<Logger, "warn"> => createLogger("langwatch:api:config");

/**
 * Telemetry flush and infrastructure release still have to finish after the
 * listener's own drain grace elapses, so the process deadline sits above it.
 */
const PROCESS_CLOSE_SLACK_MS = 15_000;

/**
 * A standalone API bootstrap accepts these deterministic aliases. Existing
 * split-process deployment uses LANGWATCH_API_PORT; API_PORT and PORT are new
 * compatibility inputs for a future physical API executable.
 */
export const API_PORT_ENV_PRECEDENCE = ["API_PORT", "LANGWATCH_API_PORT", "PORT"] as const;

/**
 * The stored-secret encryption key, under the two names the platform app has
 * always read it by, in the platform app's own order.
 *
 * The precedence is not a convenience: rows encrypted by one process are read
 * back by the other, so a deployment that set only `NEXTAUTH_SECRET` must give
 * both processes the same key or the API process would write values the app
 * cannot read.
 */
export const STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE = [
  "CREDENTIALS_SECRET",
  "NEXTAUTH_SECRET",
] as const;

/**
 * The API-key pepper, under the same two names in the same order the platform
 * app reads them.
 *
 * Not a convenience: a key hashed by one process is authenticated by the
 * other, so a deployment that set only `NEXTAUTH_SECRET` must give both
 * processes the same pepper or every credential issued by one is unusable at
 * the other. It reads the same variables as the cipher key deliberately —
 * that is what the platform app does, and one of the two has to move first.
 */
export const API_KEY_PEPPER_ENV_PRECEDENCE = ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"] as const;

export const apiConfigDefinition = RuntimeConfig.define({
  /** A standalone API owns dispatch-only web behaviour. */
  processRole: Config.value(z.literal("web").default("web"), { env: "API_PROCESS_ROLE" }),
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    { env: "NODE_ENV" },
  ),
  serviceName: Config.value(z.string().min(1).default("langwatch-api"), {
    env: "API_SERVICE_NAME",
  }),
  serviceVersion: Config.value(z.string().min(1).optional(), {
    env: "SERVICE_VERSION",
  }),
  host: Config.value(z.string().min(1).default("0.0.0.0"), { env: "API_HOST" }),
  port: Config.value(portSchema.default(5560), { env: "API_PORT" }),
  httpDrainGraceMs: Config.value(z.coerce.number().int().min(0).default(5_000), {
    env: "API_HTTP_DRAIN_GRACE_MS",
  }),
  shutdown: {
    deadlineMs: Config.value(z.coerce.number().int().positive().optional(), {
      env: "API_SHUTDOWN_DEADLINE_MS",
    }),
  },
  logger: {
    format: Config.value(z.enum(["pretty", "json"]).optional(), { env: "LOG_FORMAT" }),
    level: Config.value(z.string().min(1).optional(), { env: "LOG_LEVEL" }),
    consoleLevel: Config.value(z.string().min(1).optional(), { env: "LOG_CONSOLE_LEVEL" }),
    otelExportEnabled: Config.value(environmentBooleanSchema.optional(), {
      env: "LOG_OTEL_EXPORT_ENABLED",
    }),
  },
  observability: {
    apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }),
    endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }),
    processorType: Config.value(z.enum(["simple", "batch"]).default("batch"), {
      env: "LANGWATCH_PROCESSOR_TYPE",
    }),
  },
  /**
   * The instance administrator credential the self-hosted provisioning family
   * authenticates with.
   *
   * Read here rather than where it is used, because this module is the
   * process's only environment reader: everything below receives the value.
   * It stays an unvalidated optional string on purpose — an operator who
   * exports a blank variable has NOT configured a credential, and
   * `Config.secret` would refuse the whole boot over it. What blank means is
   * the credential's own rule, and it lives with the adapter that reads it.
   */
  instanceAdminApiKey: Config.value(optionalEnvironmentString, {
    env: "LANGWATCH_INSTANCE_ADMIN_API_KEY",
  }),
  /**
   * The key the stored-secret cipher runs under, resolved from
   * {@link STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE}.
   *
   * An unvalidated optional string for the same reason the admin credential
   * and `DATABASE_URL` are: `Config.secret` is `z.string().min(1)`, so an
   * operator who exports the variable blank would take the whole process down
   * — including a deployment that composes no product services and needs no
   * key at all. `Config.secret` buys nothing else here; it carries no
   * redaction, only that refusal.
   *
   * What a blank export means, and what a key of the wrong shape means, are
   * the cipher's rules and they live with it: blank is unconfigured, and a
   * key that is not 32 bytes of hex refuses at boot rather than at the first
   * secret a customer reads.
   */
  storedSecretEncryptionKey: Config.value(optionalEnvironmentString, {
    env: "CREDENTIALS_SECRET",
  }),
  /**
   * The pepper an API key's stored hash is derived under, from the same two
   * variables in the same order as the cipher key above.
   *
   * It is a SEPARATE leaf on purpose, even though both resolve the same value
   * today. The two uses are different: the cipher decodes 32 bytes of hex, and
   * this one is the HMAC key VERBATIM — the raw string, never the decoded
   * bytes. A process that peppered with the decoded key would hash every
   * credential differently from the platform app and authenticate none of the
   * keys already issued.
   *
   * Naming them apart is also what makes them separable: a deployment that
   * ever wants to rotate one without the other changes this line, not a call
   * site that had reached for the cipher's key because it happened to be
   * nearby.
   */
  apiKeyPepper: Config.value(optionalEnvironmentString, {
    env: "API_KEY_PEPPER",
  }),
  /**
   * The pepper a VIRTUAL key's stored secret is hashed under.
   *
   * Its own leaf beside the API-key pepper above, and not the same value: a
   * virtual key is presented to the Go data plane rather than to this process,
   * and the two credential families are rotated independently. A process that
   * peppered one with the other's key would authenticate none of the keys
   * already issued.
   *
   * An unvalidated optional string for the reason every credential here is: an
   * operator who exports the variable blank has not configured a pepper, and
   * `Config.secret` would refuse the whole boot over it. What blank means is
   * the cipher's own rule and lives with it — `VirtualKeyCryptoAdapter` raises
   * `pepper_missing` at the first hash rather than at boot, so a deployment
   * that runs no gateway needs no pepper at all.
   */
  virtualKeyPepper: Config.value(optionalEnvironmentString, {
    env: "LW_VIRTUAL_KEY_PEPPER",
  }),
  /**
   * The HMAC secret the Go data plane signs its control-plane calls with.
   *
   * Read here because THIS process now serves them: `/api/internal/gateway`
   * verifies the signature before any handler runs, and the verifier takes the
   * secret as an argument rather than reading an environment of its own.
   *
   * An unvalidated optional string for the reason every credential above is:
   * an operator who exports it blank has NOT configured a secret, and
   * `Config.secret` would refuse the whole boot over it — including a
   * deployment that runs no gateway. What blank means is the gate's own rule
   * and lives with it: the internal family answers 500
   * `gateway_internal_secret_missing` rather than falling open, which is the
   * behaviour the retired application had. It is never logged.
   */
  gatewayInternalSecret: Config.value(optionalEnvironmentString, {
    env: "LW_GATEWAY_INTERNAL_SECRET",
  }),
  /**
   * The key the short-lived JWTs handed to the Go data plane are signed under.
   *
   * Its own leaf beside the HMAC secret above and NOT the same value: one
   * authenticates the data plane's calls INTO this process, the other is what
   * this process mints credentials the data plane presents onward with. They
   * are rotated independently, and a process that signed with the wrong one
   * would hand out tokens the gateway refuses.
   *
   * Optional for the same reason, and its absence is likewise the adapter's
   * rule: `GatewayJwtAdapter` refuses to sign without a secret, so
   * `/resolve-key` fails loudly rather than minting an unverifiable token. It
   * is never logged.
   */
  gatewayJwtSecret: Config.value(optionalEnvironmentString, {
    env: "LW_GATEWAY_JWT_SECRET",
  }),
  /**
   * How long after a request an outcome may still arrive, in milliseconds.
   *
   * An operator override read here because the billing reconciliation REST
   * family is what reads it on this process: it decides which recent groupings
   * are stable enough to page through. The parse and its floor belong to the
   * gateway package (`settlementGraceMs`), which is handed this raw value, so
   * the REST policy and the settlement sweeper cannot disagree about what the
   * operator asked for.
   */
  spendSettlementGraceMs: Config.value(optionalEnvironmentString, {
    env: "LW_SPEND_SETTLEMENT_GRACE_MS",
  }),
  /**
   * The bearer credential a caller must present to scrape this process's
   * metrics, under the name every other LangWatch tier reads it by.
   *
   * An unvalidated optional string for the reason the two credentials above
   * are: an operator who exports the variable blank has not configured a key,
   * and `Config.secret` would refuse the whole boot over it. What an
   * unconfigured key means is the gate's own rule and lives with it — in
   * production it means this process serves no metrics endpoint at all.
   */
  metricsApiKey: Config.value(optionalEnvironmentString, {
    env: "METRICS_API_KEY",
  }),
  /**
   * The shared bearer the Langy agent presents on its callbacks into this
   * process — the durable turn-result ingest, the session-key revoke and the
   * relay's frame stream.
   *
   * An unvalidated optional string for the reason every credential above is:
   * an operator who exports it blank has not configured a secret, and
   * `Config.secret` would refuse the whole boot over it. What blank means is
   * the gate's own rule and lives with it — the internal Langy family answers
   * 503 `Not configured` rather than falling open, so a deployment running no
   * Langy agent needs no secret at all.
   */
  langyInternalSecret: Config.value(optionalEnvironmentString, {
    env: "LANGY_INTERNAL_SECRET",
  }),
  /**
   * The operator secret the ClickHouse EXPLAIN endpoint is presented with.
   *
   * An unvalidated optional string for the reason every credential above is,
   * and what blank means is again the gate's own rule: with no key the
   * endpoint is not registered, so an operator who has not provisioned one
   * cannot reach a cross-tenant EXPLAIN by presenting nothing.
   */
  opsApiKey: Config.value(optionalEnvironmentString, {
    env: "LANGWATCH_OPS_API_KEY",
  }),
  /**
   * The two AuthZ switches, read raw and interpreted below.
   *
   * `AUTHZ_EPOCH_CACHE` is a legacy opt-in the platform app reads as "1 or
   * true, anything else off". A stricter schema here would refuse a boot over
   * a value that tier merely ignores, and two processes disagreeing about
   * whether a cache is on is worse than either answer.
   *
   * `DEMO_PROJECT_ID` names the one project whose read access is granted to
   * everybody. Blank is not a project id, so a blank export means no demo
   * project rather than a project whose id is the empty string — a filter on
   * `""` widens rather than narrows.
   */
  authz: {
    epochCache: Config.value(optionalEnvironmentString, { env: "AUTHZ_EPOCH_CACHE" }),
    demoProjectId: Config.value(optionalEnvironmentString, { env: "DEMO_PROJECT_ID" }),
    /**
     * The account the demo project's own work is attributed to.
     *
     * Read beside the project id rather than derived from it: the demo project
     * is readable by everybody, and the person it belongs to is a separate
     * fact. Both blank on a deployment with no demo project, which is the
     * shape the organization surface already answers for.
     */
    demoProjectUserId: Config.value(optionalEnvironmentString, { env: "DEMO_PROJECT_USER_ID" }),
  },
  /**
   * The deployment's ONE browser-session identity, as Better Auth is
   * configured with it.
   *
   * Read all-or-nothing on the secret, because a second Better Auth instance
   * built from a different option set does not fail — it verifies nothing and
   * answers `null`, which every caller reads as "signed out". A process that
   * cannot be certain it holds the SAME signing identity as the tier that
   * minted a cookie must compose no transport at all rather than one that
   * silently rejects every session.
   *
   * `secret` is `NEXTAUTH_SECRET`, the same variable the whole deployment
   * signs sessions with. It is read here as its own value rather than reused
   * from the stored-secret key or the API-key pepper: those two are named
   * apart precisely so a deployment can rotate one without the others, and a
   * session secret derived from either would tie a rotation nobody intended
   * to every live login.
   *
   * `url` is where this instance believes it is served and what it trusts as
   * an origin. The externally reachable origin, where a proxy makes the two
   * differ, is `BASE_HOST` — already read once as
   * `infrastructure.execution.publicBaseUrl` and taken from there rather than
   * bound a second time, so one variable cannot resolve to two values. Both
   * are trusted origins so sign-in does not fail with "Invalid origin" behind
   * a proxy.
   *
   * The two plugin switches are read the platform app's way — the literal
   * string `"on"` — because they are the same variables that tier reads, and
   * a plugin mounted in one process and not another is a route that exists
   * for half the fleet.
   *
   * `passkeyHandleSecret` salts the provisional handle a passkey sign-up
   * ceremony is minted with. It falls back to the session secret, which is
   * what the platform app does: the handle is not an authorization and a
   * deployment that set only one secret still gets a stable, unguessable
   * handle.
   */
  browserSession: {
    secret: Config.value(optionalEnvironmentString, { env: "NEXTAUTH_SECRET" }),
    url: Config.value(optionalEnvironmentString, { env: "NEXTAUTH_URL" }),
    mfaEnrollmentOpen: Config.value(optionalEnvironmentString, {
      env: "MFA_ENROLLMENT_OPEN",
    }),
    passkeysEnabled: Config.value(optionalEnvironmentString, { env: "PASSKEYS_ENABLED" }),
    passkeyHandleSecret: Config.value(optionalEnvironmentString, {
      env: "PASSKEY_HANDLE_SECRET",
    }),
  },
  infrastructure: {
    /**
     * The Postgres connection the process composes its one guarded Prisma
     * client from.
     *
     * Optional for the same reason Redis is: a process that was given no
     * database composes without one and says so at boot, rather than refusing
     * to start. What it cannot do is compose an UNCONFIGURED client — a blank
     * export is not a connection string, and a client built over one would
     * fail on its first query instead of at boot.
     */
    database: {
      url: Config.value(optionalEnvironmentString, { env: "DATABASE_URL" }),
    },
    /**
     * The TWO ClickHouse identities this process reads analytics through, and
     * they are deliberately separate values.
     *
     * `url` is the application's own connection: it is the identity every
     * charted read, every filter picker and every dashboard graph runs as, and
     * it can read whatever the schema holds because the queries built over it
     * are ours.
     *
     * `langwatchQl` is the RESTRICTED identity a member's own submitted SQL
     * runs as. It is a different database user with a row policy and a
     * read-only profile, so a statement a customer wrote cannot reach past its
     * own tenant even if every layer above it were wrong. Composing one from
     * the other — or defaulting the second to the first — would hand customer
     * SQL the administrative client, which is the one thing this split exists
     * to prevent, so they never share a variable and neither implies the other.
     *
     * Both optional: a process given neither composes no analytics and says so
     * once at boot, rather than refusing to start.
     */
    clickhouse: {
      url: Config.value(optionalEnvironmentString, { env: "CLICKHOUSE_URL" }),
      /**
       * The THIRD identity, and the one the tenant-keyed application client
       * deliberately cannot stand in for: a dedicated `langwatch_ops` account
       * with `GRANT SELECT ON langwatch.*`, no SOURCES grant and a readonly
       * profile, which the operator-only EXPLAIN endpoint runs as.
       *
       * That endpoint is cross-tenant BY DESIGN — the optimizer agent runs
       * EXPLAINs across the fleet — and `ApiClickHouseInfrastructure` hands
       * out only a tenant-keyed `resolveClient` precisely so no caller can
       * read one organization's data on another's endpoint. So this is its
       * own connection rather than a widening of that one, and an unset value
       * means the endpoint is not served at all rather than falling back to
       * the application's own client.
       */
      opsUrl: Config.value(optionalEnvironmentString, { env: "CLICKHOUSE_OPS_URL" }),
      langwatchQl: {
        url: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_URL" }),
        username: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_USER" }),
        password: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_PASSWORD" }),
        database: Config.value(optionalEnvironmentString, { env: "LWQL_DATABASE" }),
        tenantSetting: Config.value(optionalEnvironmentString, { env: "LWQL_TENANT_SETTING" }),
      },
    },
    /**
     * The three addresses the EXECUTION half needs: where the NLP engine
     * answers, where the evaluator service answers, and where this deployment
     * answers its own public API.
     *
     * `nlpServiceUrl` is the engine every Studio run, every code evaluator and
     * the evaluator keep-alive dial. Absent means this process executes no
     * workflow and no code evaluator, and says so at the call rather than
     * failing to boot — a deployment that serves only reads is a supported
     * shape.
     *
     * `publicBaseUrl` is the origin the studio's chat panel calls back into
     * when it runs a project's PUBLISHED workflow: that path deliberately goes
     * over the same public run endpoint an external caller uses, authenticated
     * as the project, so the panel exercises what a customer's integration
     * exercises. It is the deployment's public origin rather than this
     * listener's bind address, because behind a proxy those are different and
     * only the first is reachable.
     *
     * `langevalsEndpoint` is where the evaluator service answers — the SAME
     * `LANGEVALS_ENDPOINT` the worker reads. Absent means this process
     * composes no evaluator runtime at all: the gateway's guardrail check, the
     * four legacy evaluate doors and a trace re-score each refuse by name
     * rather than answering a verdict nothing produced.
     *
     * Read here rather than where they are used, because this module is the
     * process's only environment reader.
     */
    execution: {
      nlpServiceUrl: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_NLP_SERVICE",
      }),
      langevalsEndpoint: Config.value(optionalEnvironmentString, {
        env: "LANGEVALS_ENDPOINT",
      }),
      publicBaseUrl: Config.value(optionalEnvironmentString, { env: "BASE_HOST" }),
    },
    /**
     * The three facts the MODEL GATEWAY needs that are the deployment's rather
     * than the feature's.
     *
     * `isSaas` decides whether a SYSTEM provider — one credentialed by
     * LangWatch's own environment rather than by the customer — may be enabled
     * at all. A self-hosted install that happens to export `OPENAI_API_KEY`
     * for something else would otherwise find a provider it never configured
     * switched on for every project, which is why this is its own flag and not
     * inferred from the presence of a key.
     *
     * The other two fence the outbound credential probe. `blockLocalHttpCalls`
     * refuses private, loopback and link-local destinations, and
     * `allowedProxyHosts` is the literal allowlist that relaxes only that
     * block — the cloud-metadata endpoints are refused either way, whatever a
     * deployment sets. TLS verification deliberately follows `isSaas` rather
     * than the address policy: on-prem operators routinely call services with
     * self-signed certificates, which has nothing to do with whether private
     * addresses are reachable.
     *
     * All three are read here because this module is the process's only
     * environment reader.
     */
    modelProvider: {
      isSaas: Config.value(optionalEnvironmentString, { env: "IS_SAAS" }),
      blockLocalHttpCalls: Config.value(optionalEnvironmentString, {
        env: "BLOCK_LOCAL_HTTP_CALLS",
      }),
      allowedProxyHosts: Config.value(optionalEnvironmentString, {
        env: "ALLOWED_PROXY_HOSTS",
      }),
    },
    /**
     * The GitHub App this deployment reads coding-agent pull requests through.
     *
     * All five optional and read together: an install that never registered a
     * GitHub App has none of them, and the feature's own `configured` flag is
     * what turns that into "not connected" on the screen rather than a failure
     * at the call. `host` is empty for github.com and names the Enterprise
     * Server host otherwise.
     *
     * Read here because this module is the process's only environment reader.
     */
    github: {
      appId: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_APP_ID" }),
      privateKey: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_PRIVATE_KEY" }),
      appSlug: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_APP_SLUG" }),
      webhookSecret: Config.value(optionalEnvironmentString, {
        env: "GITHUB_LANGY_WEBHOOK_SECRET",
      }),
      host: Config.value(optionalEnvironmentString, { env: "GITHUB_LANGY_HOST" }),
    },
    /**
     * Where this deployment keeps the bytes it externalized out of traces,
     * datasets, scenarios and evaluation payloads.
     *
     * The BACKEND is a selection rather than a fallback chain: a deployment
     * that named `azure` means it, and resolving one of its projects to S3
     * because an S3 bucket also happens to be configured would write a
     * tenant's bytes into a bucket nothing reads them back from. The absence
     * of every S3 value is likewise not "use the shared bucket" — it is the
     * documented single-replica filesystem fallback, which the destination
     * policy owns and this module only supplies the root for.
     *
     * The per-organization ROUTES are read separately, off the variable names
     * (`DATAPLANE_S3__<label>__<organizationId>`), because a declarative
     * projection can only name variables it knows in advance. A process that
     * ignored them would resolve every project to the shared bucket: it would
     * still work, which is exactly the danger — one tenant's objects would be
     * addressed in an account they do not own and cannot read.
     */
    storedObjects: {
      backend: Config.value(z.enum(["s3", "azure"]).optional(), {
        env: "STORED_OBJECTS_BACKEND",
      }),
      localFilesystemRoot: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_LOCAL_STORAGE_PATH",
      }),
      s3: {
        bucket: Config.value(optionalEnvironmentString, { env: "S3_BUCKET_NAME" }),
        endpoint: Config.value(optionalEnvironmentString, { env: "S3_ENDPOINT" }),
        region: Config.value(optionalEnvironmentString, { env: "S3_REGION" }),
        accessKeyId: Config.value(optionalEnvironmentString, { env: "S3_ACCESS_KEY_ID" }),
        secretAccessKey: Config.value(optionalEnvironmentString, {
          env: "S3_SECRET_ACCESS_KEY",
        }),
        sessionToken: Config.value(optionalEnvironmentString, { env: "S3_SESSION_TOKEN" }),
      },
      /**
       * The Azure Blob account this deployment reads and writes through, and
       * the federated identity it authenticates as.
       *
       * Read together and interpreted nowhere here: which of the four auth
       * modes applies, which variables each one requires, and whether a
       * plaintext endpoint or a sovereign cloud is admissible are the stored
       * object feature's own rules, and `resolveAzureCredentials` is the one
       * place that decides. This module only supplies what it read.
       *
       * `identity` is the AKS azure-workload-identity webhook's own three
       * variables. They are named here because this module is the process's
       * only environment reader, not because an operator sets them: their
       * absence means the webhook never mutated this pod, which is what the
       * credential resolver's refusal says.
       */
      azure: {
        authMode: Config.value(optionalEnvironmentString, { env: "AZURE_BLOB_AUTH_MODE" }),
        accountName: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_ACCOUNT_NAME",
        }),
        accountKey: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_ACCOUNT_KEY",
        }),
        container: Config.value(optionalEnvironmentString, { env: "AZURE_BLOB_CONTAINER" }),
        endpoint: Config.value(optionalEnvironmentString, { env: "AZURE_BLOB_ENDPOINT" }),
        authorityHost: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_AUTHORITY_HOST",
        }),
        tokenAudience: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_TOKEN_AUDIENCE",
        }),
        allowInsecureTokenEndpointForTests: Config.value(optionalEnvironmentString, {
          env: "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS",
        }),
        identity: {
          tenantId: Config.value(optionalEnvironmentString, { env: "AZURE_TENANT_ID" }),
          clientId: Config.value(optionalEnvironmentString, { env: "AZURE_CLIENT_ID" }),
          federatedTokenFile: Config.value(optionalEnvironmentString, {
            env: "AZURE_FEDERATED_TOKEN_FILE",
          }),
        },
      },
    },
    redis: {
      url: Config.value(optionalEnvironmentString, { env: "REDIS_URL" }),
      clusterEndpoints: Config.value(optionalEnvironmentString, {
        env: "REDIS_CLUSTER_ENDPOINTS",
      }),
      dbIndex: Config.value(optionalEnvironmentString, { env: "REDIS_DB_INDEX" }),
    },
    groupQueue: {
      globalConcurrency: Config.value(optionalEnvironmentString, {
        env: "GLOBAL_QUEUE_CONCURRENCY",
      }),
      zstdWritesEnabled: Config.value(optionalEnvironmentString, {
        env: "GROUP_QUEUE_ZSTD_WRITES_ENABLED",
      }),
      msgpackWritesEnabled: Config.value(optionalEnvironmentString, {
        env: "GROUP_QUEUE_MSGPACK_WRITES_ENABLED",
      }),
      tenantConcurrencyCap: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DISPATCH_TENANT_CAP",
      }),
      globalConcurrencyBudget: Config.value(optionalEnvironmentString, {
        env: "LANGWATCH_DISPATCH_GLOBAL_BUDGET",
      }),
    },
  },
});

type ApiConfigProjection = ConfigValue<typeof apiConfigDefinition>;

/** The Postgres connection a process was configured with, if it was given one. */
export type ApiDatabaseConfigResolution = Readonly<{
  url: string | undefined;
}>;

/**
 * The restricted LangWatchQL identity, present only when the deployment
 * configured ALL of it.
 *
 * All-or-nothing on purpose: a partial credential is not a weaker identity, it
 * is one that cannot connect, and a workbench composed over it would answer
 * every statement with a connection failure instead of reporting that the
 * surface is unprovisioned. {@link resolveApiConfig} names what was missing
 * when some but not all of it was set.
 */
export type ApiLangWatchQLConfigResolution = Readonly<{
  url: string;
  username: string;
  password: string;
  database: string;
  tenantSetting: string;
}>;

/** The ClickHouse identities a process was configured with, if it was given any. */
export type ApiClickHouseConfigResolution = Readonly<{
  /** The application's own connection; absent means this process reads no analytics. */
  url: string | undefined;
  /** The restricted identity a member's own SQL runs as; absent means unprovisioned. */
  langwatchQl: ApiLangWatchQLConfigResolution | undefined;
  /**
   * The dedicated readonly account the operator EXPLAIN endpoint runs as;
   * absent means that endpoint is not served at all rather than falling back
   * to the application's own connection.
   */
  opsUrl: string | undefined;
  /**
   * The per-organization endpoints, keyed by organization id, from the
   * `CLICKHOUSE_URL__<label>__<organizationId>` variables every LangWatch tier
   * reads them by.
   */
  privateRoutes: readonly Readonly<{ organizationId: string; url: string; cluster: string }>[];
  /** Connection-pool sizing inputs, as the shared client resolves them. */
  poolSizing: PoolSizingInput;
}>;

/**
 * The two addresses the execution half runs on, each absent when the
 * deployment named none.
 *
 * Blank is not an address: an operator who exported either variable empty has
 * NOT configured it, and a `fetch` at `"/go/studio/execute_sync"` reports a
 * URL parse failure rather than the configuration gap that caused it.
 */
/**
 * What the model gateway was told about this deployment.
 *
 * `isSaas` is read the platform app's way — `"1"` or `"true"`, anything else
 * off — so one variable means one thing across every tier. The egress pair is
 * the address policy an outbound credential probe is judged by; an unset
 * allowlist is an empty one rather than a wildcard, because a wildcard read
 * from an absent variable is how a fence stops fencing without anyone
 * deciding it should.
 */
export type ApiModelProviderConfigResolution = Readonly<{
  isSaas: boolean;
  blockLocalHttpCalls: boolean;
  allowedProxyHosts: readonly string[];
  /**
   * The process environment a SYSTEM provider's credential and a managed
   * organization's Bedrock configuration are read from.
   *
   * A map rather than named leaves, and it is the one place in this config
   * where that is right: WHICH variable carries a provider's key is the
   * provider registry's business — sixteen providers, each with its own
   * `apiKey` and optional `endpointKey`, and custom providers naming keys no
   * schema here could enumerate — while WHETHER this deployment set them is
   * the environment's. Reading it here rather than at the gateway is what
   * keeps this module the process's only environment reader.
   */
  environment: Readonly<Record<string, string | undefined>>;
}>;

export type ApiExecutionConfigResolution = Readonly<{
  /** Where the NLP engine answers; absent means no workflow or code evaluator runs. */
  nlpServiceUrl: string | undefined;
  /** Where the evaluator service answers; absent composes no evaluator runtime. */
  langevalsEndpoint: string | undefined;
  /** This deployment's public origin; absent means the studio cannot run a published workflow. */
  publicBaseUrl: string | undefined;
}>;

/**
 * The GitHub App credentials, blank where a deployment registered none.
 *
 * Blank rather than `undefined` because that is what the feature's adapter
 * takes, and what its own `configured` flag is computed from: a connection
 * screen on an install with no App says "not connected", which is true, rather
 * than failing.
 */
export type ApiGithubConfigResolution = Readonly<{
  appId: string;
  privateKey: string;
  appSlug: string;
  webhookSecret: string;
  /** The Enterprise Server host, or absent for github.com. */
  host: string | undefined;
}>;

/** One organization's own S3 account, as a `DATAPLANE_S3__*` variable declares it. */
export type ApiDataplaneS3Route = Readonly<{
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

/**
 * The object storage this process reads externalized bytes back through.
 *
 * `backend` is the deployment's selection, `localFilesystemRoot` the
 * documented single-replica fallback, `s3` the shared account, and `routes`
 * the per-organization accounts BYOC tenants own. All four travel together
 * because the destination precedence reads all four: a route first, then the
 * selected backend, then the shared bucket, then the filesystem.
 */
export type ApiStoredObjectsConfigResolution = Readonly<{
  backend: "s3" | "azure" | undefined;
  localFilesystemRoot: string | undefined;
  s3: Readonly<{
    bucket: string | undefined;
    endpoint: string | undefined;
    region: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
    sessionToken: string | undefined;
  }>;
  /**
   * The Azure Blob block, as read. Every rule about which of these a given
   * auth mode requires lives in `@langwatch/stored-object-server`, so this is
   * the raw shape its resolver takes rather than a validated credential.
   */
  azure: AzureBlobCredentialsConfig & { identity: AzureInjectedIdentity };
  routes: ReadonlyMap<string, ApiDataplaneS3Route>;
}>;

export type ApiInfrastructureConfig = Readonly<{
  database: ApiDatabaseConfigResolution;
  clickhouse: ApiClickHouseConfigResolution;
  execution: ApiExecutionConfigResolution;
  github: ApiGithubConfigResolution;
  modelProvider: ApiModelProviderConfigResolution;
  storedObjects: ApiStoredObjectsConfigResolution;
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
}>;

/** The AuthZ decisions this process was configured with, already interpreted. */
export type ApiAuthzConfig = Readonly<{
  /** Whether an organization's permission reads may be served from the epoch cache. */
  epochCacheEnabled: boolean;
  /** The project every caller may read, where a deployment names one. */
  demoProjectId: string | undefined;
  /** The account that project's work is attributed to. */
  demoProjectUserId: string | undefined;
}>;

/**
 * The browser-session identity, present only when this deployment named a
 * signing secret and a base URL.
 *
 * Absent means this process composes no Better Auth transport and mounts no
 * transports that authenticate a browser caller — the stated consequence,
 * rather than an instance built over a guessed secret that would answer
 * "signed out" to everybody.
 */
export type ApiBrowserSessionConfig = Readonly<{
  secret: string;
  baseUrl: string;
  publicBaseUrl: string | undefined;
  mfaEnrollmentOpen: boolean;
  passkeysEnabled: boolean;
  passkeyHandleSecret: string;
}>;

export type ApiShutdownConfig = Readonly<{
  /** The whole shutdown sequence's budget, listener drain included. */
  processDeadlineMs: number;
}>;

export type ApiConfig = Readonly<
  Omit<ApiConfigProjection, "authz" | "browserSession" | "infrastructure" | "shutdown"> & {
    authz: ApiAuthzConfig;
    /** The deployment's one browser-session identity, or nothing. */
    browserSession: ApiBrowserSessionConfig | undefined;
    /**
     * This deployment's rollout switches, as every LangWatch tier reads them.
     *
     * Resolved from the same environment source as everything else here, and
     * folded through the flag registry's own resolver, so a flag forced on for
     * one process is forced on for all of them rather than for whichever tier
     * remembered to read the variable.
     */
    featureFlags: FeatureFlagConfig;
    infrastructure: ApiInfrastructureConfig;
    /**
     * Where this process pushes its own metrics, if it was told to push any.
     *
     * Its own leaf rather than part of `observability`: that block is the
     * LangWatch SDK's identity for traces, and these are the OTLP collector's
     * for metrics. They are configured by different variables, can be
     * configured independently, and a deployment that set one and not the
     * other means exactly that.
     */
    otlpMetrics: OtlpMetricsExportOptions;
    shutdown: ApiShutdownConfig;
  }
>;

/** Parses executable configuration once, before API services are composed. */
export function resolveApiConfig(source: Readonly<Record<string, unknown>>): ApiConfig {
  const value = RuntimeConfig.create({
    name: "api",
    definition: apiConfigDefinition,
    source: {
      ...source,
      API_PORT: firstDefined(source, API_PORT_ENV_PRECEDENCE),
      CREDENTIALS_SECRET: firstDefined(source, STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE),
      API_KEY_PEPPER: firstDefined(source, API_KEY_PEPPER_ENV_PRECEDENCE),
    },
  }).value;
  refuseApiSelfIngest(value);
  return {
    ...value,
    featureFlags: resolveFeatureFlagConfig(source),
    otlpMetrics: otlpMetricsExportOptionsFrom({
      telemetry: resolveTelemetryConfiguration(source),
      serviceName: value.serviceName,
    }),
    authz: {
      // The platform app's exact rule, so one variable means one thing across
      // the deployment rather than one thing per tier.
      epochCacheEnabled: value.authz.epochCache === "1" || value.authz.epochCache === "true",
      demoProjectId: value.authz.demoProjectId?.trim() || undefined,
      demoProjectUserId: value.authz.demoProjectUserId?.trim() || undefined,
    },
    browserSession: resolveBrowserSessionConfig({
      ...value.browserSession,
      publicUrl: value.infrastructure.execution.publicBaseUrl,
    }),
    shutdown: {
      processDeadlineMs:
        value.shutdown.deadlineMs ?? value.httpDrainGraceMs + PROCESS_CLOSE_SLACK_MS,
    },
    infrastructure: {
      database: { url: value.infrastructure.database.url },
      clickhouse: {
        url: value.infrastructure.clickhouse.url?.trim() || undefined,
        langwatchQl: resolveLangWatchQLConnection(value.infrastructure.clickhouse.langwatchQl),
        opsUrl: value.infrastructure.clickhouse.opsUrl?.trim() || undefined,
        privateRoutes: resolvePrivateClickHouseRoutes(source),
        poolSizing: poolSizingFromEnv(environmentStrings(source)),
      },
      execution: {
        nlpServiceUrl: value.infrastructure.execution.nlpServiceUrl?.trim() || undefined,
        langevalsEndpoint: value.infrastructure.execution.langevalsEndpoint?.trim() || undefined,
        publicBaseUrl: value.infrastructure.execution.publicBaseUrl?.trim() || undefined,
      },
      modelProvider: resolveModelProviderConfig(
        value.infrastructure.modelProvider,
        environmentStrings(source),
      ),
      github: {
        appId: value.infrastructure.github.appId?.trim() ?? "",
        privateKey: value.infrastructure.github.privateKey?.trim() ?? "",
        appSlug: value.infrastructure.github.appSlug?.trim() ?? "",
        webhookSecret: value.infrastructure.github.webhookSecret?.trim() ?? "",
        host: value.infrastructure.github.host?.trim() || undefined,
      },
      storedObjects: {
        backend: value.infrastructure.storedObjects.backend,
        localFilesystemRoot:
          value.infrastructure.storedObjects.localFilesystemRoot?.trim() || undefined,
        s3: {
          bucket: value.infrastructure.storedObjects.s3.bucket?.trim() || undefined,
          endpoint: value.infrastructure.storedObjects.s3.endpoint?.trim() || undefined,
          region: value.infrastructure.storedObjects.s3.region?.trim() || undefined,
          accessKeyId: value.infrastructure.storedObjects.s3.accessKeyId?.trim() || undefined,
          secretAccessKey:
            value.infrastructure.storedObjects.s3.secretAccessKey?.trim() || undefined,
          sessionToken: value.infrastructure.storedObjects.s3.sessionToken?.trim() || undefined,
        },
        azure: {
          backend: value.infrastructure.storedObjects.backend,
          authMode: value.infrastructure.storedObjects.azure.authMode?.trim() || undefined,
          accountName: value.infrastructure.storedObjects.azure.accountName?.trim() || undefined,
          accountKey: value.infrastructure.storedObjects.azure.accountKey?.trim() || undefined,
          container: value.infrastructure.storedObjects.azure.container?.trim() || undefined,
          endpoint: value.infrastructure.storedObjects.azure.endpoint?.trim() || undefined,
          authorityHost:
            value.infrastructure.storedObjects.azure.authorityHost?.trim() || undefined,
          tokenAudience:
            value.infrastructure.storedObjects.azure.tokenAudience?.trim() || undefined,
          // The escape hatch is refused outright in production, so a value set
          // on a real deployment cannot put a bearer token on the wire in
          // plaintext no matter who sets it. This is where that is decided:
          // the guard downstream is handed a boolean, not a variable to read.
          allowInsecureTokenEndpointForTests:
            process.env.NODE_ENV !== "production" &&
            value.infrastructure.storedObjects.azure.allowInsecureTokenEndpointForTests?.trim() ===
              "1",
          identity: {
            tenantId:
              value.infrastructure.storedObjects.azure.identity.tenantId?.trim() || undefined,
            clientId:
              value.infrastructure.storedObjects.azure.identity.clientId?.trim() || undefined,
            federatedTokenFile:
              value.infrastructure.storedObjects.azure.identity.federatedTokenFile?.trim() ||
              undefined,
          },
        },
        routes: resolveDataplaneS3Routes(source),
      },
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
    },
  };
}

/**
 * Refuses a boot whose telemetry exporter points back at this deployment.
 *
 * The platform process this one replaced refused `LANGWATCH_API_KEY` outright,
 * because with a key set the SDK ships the process's own operational telemetry
 * into whatever ingest it is pointed at, and that ingest was always this one:
 * a feedback loop in which every ingested span does work that emits more
 * spans. This process accepts the key on purpose — exporting to a DIFFERENT
 * LangWatch install is a supported shape — so the refusal narrowed to the one
 * case the blanket rule was protecting.
 *
 * The three addresses are this deployment's own, in the order an operator
 * recognises them: the public origin, the origin sessions are signed for, and
 * the listener this process binds. `port` is passed apart from `host` because
 * `API_HOST` is a bind address and carries none.
 */
function refuseApiSelfIngest(value: ApiConfigProjection): void {
  assertObservabilityDoesNotSelfIngest({
    runtime: "api",
    apiKeyEnv: "LANGWATCH_API_KEY",
    apiKey: value.observability.apiKey,
    endpointEnv: "LANGWATCH_ENDPOINT",
    endpoint: value.observability.endpoint,
    deployment: [
      { env: "BASE_HOST", value: value.infrastructure.execution.publicBaseUrl },
      { env: "NEXTAUTH_URL", value: value.browserSession.url },
      { env: "API_HOST/API_PORT", value: value.host, port: value.port },
    ],
  });
}

/**
 * The browser-session identity, or nothing at all.
 *
 * Both halves are required together and neither is defaulted. A secret with no
 * base URL cannot state a trusted origin, and a base URL with no secret cannot
 * verify a cookie; either alone would compose an instance that rejects every
 * session while looking configured.
 */
function resolveBrowserSessionConfig(
  value: Readonly<{
    secret: string | undefined;
    url: string | undefined;
    publicUrl: string | undefined;
    mfaEnrollmentOpen: string | undefined;
    passkeysEnabled: string | undefined;
    passkeyHandleSecret: string | undefined;
  }>,
): ApiBrowserSessionConfig | undefined {
  const secret = value.secret?.trim() || undefined;
  const baseUrl = value.url?.trim() || undefined;
  if (!secret || !baseUrl) return undefined;

  return {
    secret,
    baseUrl,
    publicBaseUrl: value.publicUrl?.trim() || undefined,
    // The platform app reads both as the literal string "on", so this one
    // does too: a plugin mounted in one process and not another is a route
    // that exists for half the fleet.
    mfaEnrollmentOpen: value.mfaEnrollmentOpen?.trim() === "on",
    passkeysEnabled: value.passkeysEnabled?.trim() === "on",
    passkeyHandleSecret: value.passkeyHandleSecret?.trim() || secret,
  };
}

/**
 * The deployment's answers for the model gateway.
 *
 * Both flags are read the platform app's way: `"1"` or `"true"` is on, and
 * every other value — including a variable set to something well-meant like
 * `"yes"` — is off, because two tiers disagreeing about whether a fence is up
 * is worse than either answer. The allowlist is split on commas and trimmed,
 * and blank entries are dropped: an empty host matches nothing useful and
 * would otherwise sit in the list looking like a rule.
 */
function resolveModelProviderConfig(
  value: Readonly<{
    isSaas: string | undefined;
    blockLocalHttpCalls: string | undefined;
    allowedProxyHosts: string | undefined;
  }>,
  environment: Readonly<Record<string, string | undefined>>,
): ApiModelProviderConfigResolution {
  return {
    isSaas: isEnabledFlag(value.isSaas),
    blockLocalHttpCalls: isEnabledFlag(value.blockLocalHttpCalls),
    allowedProxyHosts:
      value.allowedProxyHosts
        ?.split(",")
        .map((host) => host.trim())
        .filter((host) => host.length > 0) ?? [],
    environment,
  };
}

/** The platform app's exact reading of a boolean environment variable. */
function isEnabledFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * The restricted identity, or nothing — never half of one.
 *
 * A deployment that set SOME of the five meant to switch the workbench on and
 * would otherwise get a silent refusal on every statement, so the omission is
 * named. One that set none is simply not running the surface and says nothing.
 * Variable names only, never their values: one of these is a password.
 */
function resolveLangWatchQLConnection(
  value: Readonly<{
    url: string | undefined;
    username: string | undefined;
    password: string | undefined;
    database: string | undefined;
    tenantSetting: string | undefined;
  }>,
): ApiLangWatchQLConfigResolution | undefined {
  const required = [
    ["LWQL_CLICKHOUSE_URL", value.url],
    ["LWQL_CLICKHOUSE_USER", value.username],
    ["LWQL_CLICKHOUSE_PASSWORD", value.password],
    ["LWQL_DATABASE", value.database],
    ["LWQL_TENANT_SETTING", value.tenantSetting],
  ] as const;
  const absent = required.filter(([, entry]) => !entry?.trim()).map(([name]) => name);

  if (absent.length > 0) {
    if (absent.length < required.length) {
      configLogger().warn(
        { absent },
        "LangWatchQL is partially configured, so every statement will be refused",
      );
    }
    return undefined;
  }
  // Re-checked rather than asserted: `absent` is computed by a callback, which
  // TypeScript cannot use to narrow these five.
  const { url, username, password, database, tenantSetting } = value;
  if (!url || !username || !password || !database || !tenantSetting) return undefined;
  return { url, username, password, database, tenantSetting };
}

/**
 * The per-organization ClickHouse endpoints, parsed by the shared client's own
 * rule so this process routes a tenant exactly as every other tier does.
 *
 * A malformed variable is skipped rather than fatal, and an ambiguous
 * `<label>__<organizationId>` split is reported: guessing wrong is a silent
 * fail-open, in which the intended organization's tenants read the shared
 * instance instead.
 */
function resolvePrivateClickHouseRoutes(
  source: Readonly<Record<string, unknown>>,
): readonly Readonly<{ organizationId: string; url: string; cluster: string }>[] {
  const table = parseRoutingTable(environmentStrings(source));
  for (const skipped of table.skipped) {
    configLogger().warn(
      { envVar: skipped.envVar, reason: skipped.reason },
      "Ignoring a malformed ClickHouse route variable",
    );
  }
  for (const guess of table.ambiguous) {
    configLogger().warn(
      { envVar: guess.envVar, organizationId: guess.organizationId },
      "A ClickHouse route variable was split by guess; rename it if that is not the intent",
    );
  }
  return [...table.routes].map(([organizationId, url]) => ({
    organizationId,
    url,
    cluster: organizationId,
  }));
}

/** The environment bag as the shared ClickHouse helpers read it. */
function environmentStrings(
  source: Readonly<Record<string, unknown>>,
): Record<string, string | undefined> {
  const strings: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string") strings[name] = value;
  }
  return strings;
}

/**
 * The logger receives semantic process values, never a raw environment source.
 *
 * Delegates to `loggerConfigurationFrom` in `@langwatch/observability`: every
 * process (api, worker, and any future one) folds its parsed config through
 * the same one-place mapping, so a new logger field lands in one map instead
 * of drifting across N copies.
 */
export function apiLoggerConfiguration(config: ApiConfig): LoggerConfiguration {
  return loggerConfigurationFrom(config);
}

/** Builds SDK setup from parsed semantic configuration before boot side effects. */
export function apiObservabilityConfiguration(config: ApiConfig): ProcessObservabilityOptions {
  const langwatch = config.observability.apiKey
    ? {
        apiKey: config.observability.apiKey,
        endpoint: config.observability.endpoint,
        processorType: config.observability.processorType,
      }
    : ("disabled" as const);

  return {
    serviceName: config.serviceName,
    loggerName: config.serviceName,
    setup: {
      langwatch,
      attributes: {
        "deployment.environment.name": config.environment,
        ...(config.serviceVersion ? { "service.version": config.serviceVersion } : {}),
      },
    },
  };
}

function firstDefined(
  source: Readonly<Record<string, unknown>>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The per-organization S3 routes this deployment declares.
 *
 * Parsed by the shared helper rather than by a second reader here: the
 * variable NAMES carry the organization id — `DATAPLANE_S3__<label>__<organizationId>`
 * — so the declarative projection can only name variables it knows in advance,
 * and a process splitting `<label>__<organizationId>` differently from another
 * would address a tenant's objects somewhere they cannot read them.
 *
 * A malformed entry is skipped and named in the log; a duplicate organization
 * id is raised by the helper, because two routes for one tenant is a question
 * this process cannot answer.
 */
function resolveDataplaneS3Routes(
  source: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, ApiDataplaneS3Route> {
  const table = parseDataplaneS3RoutingTable(source);
  for (const skipped of table.skipped) {
    configLogger().warn(
      { envVar: skipped.envVar, reason: skipped.reason },
      "Ignoring a malformed private S3 route variable",
    );
  }
  return table.routes;
}
