/**
 * What the interactive process IS: the api role, the config it parsed, and the
 * modules this build installs.
 *
 * There is no wiring left here. Every family the api serves is an installed
 * module that declares its own repositories, its own transports and the
 * members it reads; boot builds exactly that union, in order, and refuses by
 * module and member when this deployment configured none. What used to be
 * 4,989 lines of hand-composition is the module list and the mapping from the
 * api's own parsed config onto the members every process states the same way.
 */
import {
  createProcess,
  type MailConfig,
  type MemberName,
  type ProcessConfig,
  type ProcessMembers,
} from "@langwatch/infrastructure";
import { serverModules } from "@langwatch/installed-modules/server";
import type { BootedRuntime } from "@langwatch/runtime-composition";
import type { ApiConfig } from "../platform/config/api.config.ts";

/** The api process's own rate allowance, until a deployment states one. */
const DEFAULT_RATE_ALLOWANCE = { requests: 60, seconds: 60 } as const;

/**
 * The api's parsed config, as every process states itself.
 *
 * A datastore this deployment did not name is left out rather than defaulted:
 * an absent address is never a decision to run without the store, so the
 * member refuses by name at boot and the module that reads it is named with
 * it. The only way to run a module without its stores is to install it on its
 * memory repositories, in code.
 */
export function apiProcessConfig(options: {
  readonly config: ApiConfig;
  /** Every secret this process resolved at boot (ADR-132). */
  readonly secrets: Readonly<Record<string, string>>;
}): ProcessConfig {
  const { config, secrets } = options;
  const infrastructure = config.infrastructure;
  const clickhouse = infrastructure.clickhouse;
  const s3 = infrastructure.storedObjects.s3;

  return {
    processName: config.serviceName,
    encryptionKey: config.storedSecretEncryptionKey ?? "",
    secrets,
    rateLimit: DEFAULT_RATE_ALLOWANCE,
    ...(infrastructure.database.url ? { database: { url: infrastructure.database.url } } : {}),
    ...(clickhouse.url || clickhouse.privateRoutes.length > 0
      ? {
          clickhouse: {
            ...(clickhouse.url ? { url: clickhouse.url } : {}),
            privateRoutes: clickhouse.privateRoutes.map((route) => ({
              organizationId: route.organizationId,
              url: route.url,
            })),
          },
        }
      : {}),
    ...redisSlice(infrastructure.redis),
    ...(s3.bucket
      ? {
          objectStorage: {
            bucket: s3.bucket,
            ...(s3.region ? { region: s3.region } : {}),
            ...(s3.endpoint ? { endpoint: s3.endpoint, forcePathStyle: true } : {}),
            ...(s3.accessKeyId && s3.secretAccessKey
              ? {
                  credentials: {
                    accessKeyId: s3.accessKeyId,
                    secretAccessKey: s3.secretAccessKey,
                    ...(s3.sessionToken ? { sessionToken: s3.sessionToken } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    mail: mailSlice(config),
  };
}

/** Redis, in whichever of its two shapes this deployment named. */
function redisSlice(
  redis: ApiConfig["infrastructure"]["redis"],
): Pick<ProcessConfig, "redis"> | Record<string, never> {
  if (!redis.configured) return {};
  if (redis.mode === "cluster") {
    return {
      redis: {
        clusterEndpoints: redis.endpoints
          .map((endpoint) => `${endpoint.host}:${endpoint.port}`)
          .join(","),
      },
    };
  }
  return { redis: { url: redis.url, dbIndex: redis.db } };
}

/**
 * Which gateway this deployment sends through.
 *
 * `off` is a statement, so a deployment that named no gateway reaches the mail
 * member as a refusal by name rather than as messages dropped quietly.
 */
function mailSlice(config: ApiConfig): MailConfig {
  const mail = config.mail;
  if (!mail) return { provider: "off" };
  const mailer = mail.mailer;
  const defaultFrom = mailer.defaultFrom;
  if (mailer.resend.apiKey) {
    return { provider: "resend", defaultFrom, apiKey: mailer.resend.apiKey };
  }
  if (mailer.ses.enabled && mailer.ses.region) {
    return {
      provider: "ses",
      defaultFrom,
      region: mailer.ses.region,
      ...(mailer.ses.endpoint ? { endpoint: mailer.ses.endpoint } : {}),
    };
  }
  if (mailer.smtp.host && mailer.smtp.user && mailer.smtp.password) {
    return {
      provider: "smtp",
      defaultFrom,
      host: mailer.smtp.host,
      port: Number(mailer.smtp.port ?? 587),
      user: mailer.smtp.user,
      password: mailer.smtp.password,
      ...(mailer.smtp.secure === "true" ? { secure: true } : {}),
    };
  }
  return { provider: "off" };
}

/** What a caller may hand this process instead of letting it build one. */
export type ApiProcessMemberOverrides = {
  readonly [Name in MemberName]?: ProcessMembers[Name];
};

/**
 * The api process, booted.
 *
 * Nothing is constructed until `boot`, and boot builds exactly the union the
 * installed modules declared: a client no module reads is never opened.
 */
export function bootApiProcess(options: {
  readonly config: ApiConfig;
  readonly secrets: Readonly<Record<string, string>>;
  readonly members?: ApiProcessMemberOverrides;
}): Promise<BootedRuntime<ProcessMembers>> {
  return createProcess({
    role: "api",
    config: apiProcessConfig({ config: options.config, secrets: options.secrets }),
    members: options.members,
  })
    .withModules(serverModules)
    .boot();
}
