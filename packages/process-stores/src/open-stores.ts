import type { ScopedSecrets } from "@langwatch/secrets";

import { clickhouseRoutesOf } from "./clickhouse-routes.ts";
import { storesOwner, type StoresConfig } from "./config-owner.ts";
import type { ClickHousePrivateRoute, ObjectStorageConfig, ProcessConfig } from "./config.ts";
import { buildProcessStores, type ProcessStores } from "./create-members.ts";
import type { PipelineParticipation } from "./pipeline-selection.ts";

/** The documented single-replica root, when a filesystem deployment names none. */
const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";

type StorageSecrets = Readonly<{
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  sessionToken: string | undefined;
  accountKey: string | undefined;
}>;

function withStorageSecrets<Out>(
  secrets: ScopedSecrets,
  build: (values: StorageSecrets) => Out | Promise<Out>,
): Promise<Out> {
  return secrets.into(storesOwner.secrets.s3AccessKeyId, (accessKeyId) =>
    secrets.into(storesOwner.secrets.s3SecretAccessKey, (secretAccessKey) =>
      secrets.into(storesOwner.secrets.s3SessionToken, (sessionToken) =>
        secrets.into(storesOwner.secrets.azureAccountKey, (accountKey) =>
          build({ accessKeyId, secretAccessKey, sessionToken, accountKey }),
        ),
      ),
    ),
  );
}

/** Credentials only when both key halves are present: a partial pair breaks the SDK's own chain. */
function s3Credentials(values: StorageSecrets) {
  const { accessKeyId, secretAccessKey, sessionToken } = values;
  if (!accessKeyId || !secretAccessKey) return {};
  return {
    credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
  };
}

function objectStorageConfig(options: {
  settings: StoresConfig["objectStorage"];
  values: StorageSecrets;
  production: boolean;
}): ObjectStorageConfig {
  const { settings, values, production } = options;
  const backend = settings.backend ?? (settings.s3.bucket ? "s3" : "file");
  switch (backend) {
    case "s3":
      return {
        backend,
        s3: {
          bucket: settings.s3.bucket ?? "",
          ...(settings.s3.endpoint ? { endpoint: settings.s3.endpoint } : {}),
          ...(settings.s3.region ? { region: settings.s3.region } : {}),
          ...s3Credentials(values),
        },
      };
    case "azure": {
      const { allowInsecureTokenEndpointForTests, ...azure } = settings.azure;
      return {
        backend,
        azure: {
          ...azure,
          ...(values.accountKey ? { accountKey: values.accountKey } : {}),
          allowInsecureTokenEndpointForTests:
            !production && allowInsecureTokenEndpointForTests === "1",
        },
      };
    }
    case "file":
      return { backend, root: settings.localRoot ?? DEFAULT_LOCAL_STORAGE_ROOT };
  }
}

function processConfigOf(options: {
  name: string;
  config: StoresConfig;
  pipelines: PipelineParticipation;
  urls: Readonly<{
    database: string | undefined;
    clickhouse: string | undefined;
    redis: string | undefined;
  }>;
  clickhouseRoutes: readonly ClickHousePrivateRoute[];
  encryption: string | undefined;
  storage: StorageSecrets;
  production: boolean;
}): ProcessConfig {
  const { name, config, pipelines, urls, clickhouseRoutes, encryption, storage, production } =
    options;
  // A deployment whose every tenant is private names no shared URL, and still has ClickHouse.
  const clickhouse =
    urls.clickhouse || clickhouseRoutes.length > 0
      ? {
          clickhouse: {
            ...(urls.clickhouse ? { url: urls.clickhouse } : {}),
            ...(clickhouseRoutes.length > 0 ? { privateRoutes: clickhouseRoutes } : {}),
            poolSizing: config.clickhousePool,
          },
        }
      : {};
  return {
    processName: name,
    encryptionKey: encryption ?? "",
    secrets: {},
    rateLimit: config.rateLimit,
    ...(urls.database ? { database: { url: urls.database } } : {}),
    ...clickhouse,
    ...(urls.redis
      ? {
          redis: {
            url: urls.redis,
            ...(config.redis.dbIndex === undefined ? {} : { dbIndex: config.redis.dbIndex }),
          },
        }
      : {}),
    eventing: pipelines.configure({
      defaultRetentionDays: config.defaultRetentionDays,
      queueDrainTimeoutMs: config.shutdownDrainTimeoutMs,
    }),
    objectStorage: objectStorageConfig({
      settings: config.objectStorage,
      values: storage,
      production,
    }),
  };
}

/** Connection values remain inside the construction closure; only opened members escape. */
export function openProcessStores(options: {
  name: string;
  config: StoresConfig;
  secrets: ScopedSecrets;
  pipelines: PipelineParticipation;
  production: boolean;
}): Promise<ProcessStores> {
  const { name, config, secrets, pipelines, production } = options;
  return secrets.into(storesOwner.secrets.database, (database) =>
    secrets.into(storesOwner.secrets.clickhouse, (clickhouse) =>
      secrets.into(storesOwner.secrets.clickhouseRoutes, (routes) =>
        secrets.into(storesOwner.secrets.redis, (redis) =>
          secrets.into(storesOwner.secrets.encryption, (credentials) =>
            secrets.into(storesOwner.secrets.encryptionFallback, (session) =>
              withStorageSecrets(secrets, (storage) =>
                buildProcessStores({
                  config: processConfigOf({
                    name,
                    config,
                    pipelines,
                    urls: { database, clickhouse, redis },
                    clickhouseRoutes: clickhouseRoutesOf(routes),
                    encryption: credentials ?? session,
                    storage,
                    production,
                  }),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
