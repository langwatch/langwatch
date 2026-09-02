import {
  Config,
  environmentBooleanSchema,
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
import { parseRoutingTable, poolSizingFromEnv, type PoolSizingInput } from "@langwatch/clickhouse-client";
import type { ProcessObservabilityOptions } from "@langwatch/observability/node";
import { resolveGroupQueuePolicyFromEnv, type GroupQueuePolicy } from "@langwatch/group-queue";
import {
  resolveFeatureFlagConfig,
  type FeatureFlagConfig,
} from "@langwatch/feature-flag-contract";
import { RedisConfigService, type RedisConfigResolution } from "@langwatch/redis-client";
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
      langwatchQl: {
        url: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_URL" }),
        username: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_USER" }),
        password: Config.value(optionalEnvironmentString, { env: "LWQL_CLICKHOUSE_PASSWORD" }),
        database: Config.value(optionalEnvironmentString, { env: "LWQL_DATABASE" }),
        tenantSetting: Config.value(optionalEnvironmentString, { env: "LWQL_TENANT_SETTING" }),
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
   * The per-organization endpoints, keyed by organization id, from the
   * `CLICKHOUSE_URL__<label>__<organizationId>` variables every LangWatch tier
   * reads them by.
   */
  privateRoutes: readonly Readonly<{ organizationId: string; url: string; cluster: string }>[];
  /** Connection-pool sizing inputs, as the shared client resolves them. */
  poolSizing: PoolSizingInput;
}>;

export type ApiInfrastructureConfig = Readonly<{
  database: ApiDatabaseConfigResolution;
  clickhouse: ApiClickHouseConfigResolution;
  redis: RedisConfigResolution;
  groupQueue: GroupQueuePolicy;
}>;

/** The AuthZ decisions this process was configured with, already interpreted. */
export type ApiAuthzConfig = Readonly<{
  /** Whether an organization's permission reads may be served from the epoch cache. */
  epochCacheEnabled: boolean;
  /** The project every caller may read, where a deployment names one. */
  demoProjectId: string | undefined;
}>;

export type ApiShutdownConfig = Readonly<{
  /** The whole shutdown sequence's budget, listener drain included. */
  processDeadlineMs: number;
}>;

export type ApiConfig = Readonly<
  Omit<ApiConfigProjection, "authz" | "infrastructure" | "shutdown"> & {
    authz: ApiAuthzConfig;
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
  return {
    ...value,
    featureFlags: resolveFeatureFlagConfig(source),
    authz: {
      // The platform app's exact rule, so one variable means one thing across
      // the deployment rather than one thing per tier.
      epochCacheEnabled: value.authz.epochCache === "1" || value.authz.epochCache === "true",
      demoProjectId: value.authz.demoProjectId?.trim() || undefined,
    },
    shutdown: {
      processDeadlineMs:
        value.shutdown.deadlineMs ?? value.httpDrainGraceMs + PROCESS_CLOSE_SLACK_MS,
    },
    infrastructure: {
      database: { url: value.infrastructure.database.url },
      clickhouse: {
        url: value.infrastructure.clickhouse.url?.trim() || undefined,
        langwatchQl: resolveLangWatchQLConnection(value.infrastructure.clickhouse.langwatchQl),
        privateRoutes: resolvePrivateClickHouseRoutes(source),
        poolSizing: poolSizingFromEnv(environmentStrings(source)),
      },
      redis: new RedisConfigService().resolve(value.infrastructure.redis),
      groupQueue: resolveGroupQueuePolicyFromEnv(value.infrastructure.groupQueue),
    },
  };
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
