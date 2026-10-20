import type { ScopedSecrets } from "@langwatch/secrets";

import { clickhouseRouteFamilyOf } from "./clickhouse-routes.ts";
import { storesOwner, type StoresConfig } from "./config-owner.ts";
import type { ObjectStorageAzureConfig, ObjectStorageConfig, ProcessConfig } from "./config.ts";
import { buildProcessStores, type ProcessStores } from "./create-members.ts";
import { objectStoragePrivateFamilyOf } from "./object-storage-private-accounts.ts";
import type { PipelineParticipation } from "./pipeline-selection.ts";

/** The documented single-replica root, when a filesystem deployment names none. */
const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";

type StorageSecrets = Readonly<{
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  sessionToken: string | undefined;
  accountKey: string | undefined;
  dataplaneS3: ReadonlyMap<string, string>;
}>;

function withStorageSecrets<Out>(
  secrets: ScopedSecrets,
  build: (values: StorageSecrets) => Out | Promise<Out>,
): Promise<Out> {
  return secrets.into(storesOwner.secrets.s3AccessKeyId, (accessKeyId) =>
    secrets.into(storesOwner.secrets.s3SecretAccessKey, (secretAccessKey) =>
      secrets.into(storesOwner.secrets.s3SessionToken, (sessionToken) =>
        secrets.into(storesOwner.secrets.azureAccountKey, (accountKey) =>
          secrets.into(storesOwner.secrets.dataplaneS3, (dataplaneS3) =>
            build({ accessKeyId, secretAccessKey, sessionToken, accountKey, dataplaneS3 }),
          ),
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

function azureConfigOf(options: {
  settings: StoresConfig["objectStorage"]["azure"];
  values: StorageSecrets;
  production: boolean;
}): ObjectStorageAzureConfig {
  const { settings, values, production } = options;
  const { allowInsecureTokenEndpointForTests, ...azure } = settings;
  return {
    ...azure,
    ...(values.accountKey ? { accountKey: values.accountKey } : {}),
    allowInsecureTokenEndpointForTests: !production && allowInsecureTokenEndpointForTests === "1",
  };
}

function objectStorageConfig(options: {
  settings: StoresConfig["objectStorage"];
  values: StorageSecrets;
  production: boolean;
}): ObjectStorageConfig {
  const { settings, values, production } = options;
  const bucket = settings.s3.bucket?.trim();
  const backend = settings.backend ?? (bucket ? "s3" : "file");
  const azure = azureConfigOf({ settings: settings.azure, values, production });
  const file = { backend: "file", root: settings.localRoot ?? DEFAULT_LOCAL_STORAGE_ROOT } as const;
  // An organisation with its own S3 account is placed there whatever the shared backend is.
  const { accounts, malformed } = objectStoragePrivateFamilyOf({
    family: values.dataplaneS3,
    ...(settings.s3.region ? { region: settings.s3.region } : {}),
  });
  const privateAccounts = {
    privateAccounts: accounts,
    ...(malformed.length > 0 ? { malformedPrivateAccounts: malformed } : {}),
  };
  switch (backend) {
    case "s3":
      // The legacy S3 selector with no bucket keeps its documented local-filesystem fallback.
      if (!bucket) return { ...file, ...privateAccounts, legacyAzure: azure };
      return {
        backend,
        s3: {
          bucket,
          ...(settings.s3.endpoint ? { endpoint: settings.s3.endpoint } : {}),
          ...(settings.s3.region ? { region: settings.s3.region } : {}),
          ...s3Credentials(values),
        },
        ...privateAccounts,
        legacyAzure: azure,
      };
    case "azure":
      return { backend, azure, ...privateAccounts };
    case "file":
      return { ...file, ...privateAccounts, legacyAzure: azure };
  }
}

/** A deployment whose every tenant is private names no shared URL, and still has ClickHouse. */
function clickhouseConfigOf({
  config,
  url,
  clickhouseRoutes,
}: {
  config: StoresConfig;
  url: string | undefined;
  clickhouseRoutes: ReturnType<typeof clickhouseRouteFamilyOf>;
}) {
  return url || clickhouseRoutes.routes.length > 0
    ? {
        clickhouse: {
          ...(url ? { url: url } : {}),
          ...(clickhouseRoutes.routes.length > 0 ? { privateRoutes: clickhouseRoutes.routes } : {}),
          ...(clickhouseRoutes.malformed.length > 0
            ? { malformedRoutes: clickhouseRoutes.malformed }
            : {}),
          poolSizing: config.clickhousePool,
          ...(config.clickhouseStatementLaneReserveShare === undefined
            ? {}
            : { statementLaneReserveShare: config.clickhouseStatementLaneReserveShare }),
        },
      }
    : {};
}

function processConfigOf(options: {
  name: string;
  config: StoresConfig;
  pipelines: PipelineParticipation;
  urls: Readonly<{
    database: string | undefined;
    clickhouse: string | undefined;
    redis: string | undefined;
    redisClusterEndpoints: string | undefined;
  }>;
  clickhouseRoutes: ReturnType<typeof clickhouseRouteFamilyOf>;
  encryption: string | undefined;
  previousEncryption: string | undefined;
  storage: StorageSecrets;
  production: boolean;
}): ProcessConfig {
  const { name, config, pipelines, urls, clickhouseRoutes, encryption, storage, production } =
    options;
  const previousEncryptionKey = options.previousEncryption;
  const clickhouse = clickhouseConfigOf({ config, url: urls.clickhouse, clickhouseRoutes });
  return {
    processName: name,
    encryptionKey: encryption ?? "",
    ...(previousEncryptionKey ? { previousEncryptionKey } : {}),
    secrets: {},
    rateLimit: config.rateLimit,
    ...(urls.database ? { database: { url: urls.database } } : {}),
    ...clickhouse,
    ...(urls.redis || urls.redisClusterEndpoints
      ? {
          redis: {
            ...(urls.redis ? { url: urls.redis } : {}),
            ...(urls.redisClusterEndpoints ? { clusterEndpoints: urls.redisClusterEndpoints } : {}),
            ...(config.redis.dbIndex === undefined ? {} : { dbIndex: config.redis.dbIndex }),
          },
        }
      : {}),
    eventing: pipelines.configure({
      defaultRetentionDays: config.defaultRetentionDays,
      queueDrainTimeoutMs: config.shutdownDrainTimeoutMs,
      queueConcurrency: config.queueConcurrency,
      queueConcurrencyCeiling: config.queueConcurrencyCeiling,
      queueTenantCap: config.queueTenantCap,
      queueGlobalBudget: config.queueGlobalBudget,
    }),
    objectStorage: objectStorageConfig({
      settings: config.objectStorage,
      values: storage,
      production,
    }),
  };
}

/** Connection values remain inside the construction closure; only opened members escape. */
export function openStores(options: {
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
          secrets.into(storesOwner.secrets.redisClusterEndpoints, (redisClusterEndpoints) =>
            secrets.into(storesOwner.secrets.encryption, (credentials) =>
              secrets.into(storesOwner.secrets.encryptionFallback, (session) =>
                secrets.into(storesOwner.secrets.encryptionPrevious, (previous) =>
                  withStorageSecrets(secrets, (storage) =>
                    buildProcessStores({
                      config: processConfigOf({
                        name,
                        config,
                        pipelines,
                        urls: { database, clickhouse, redis, redisClusterEndpoints },
                        clickhouseRoutes: clickhouseRouteFamilyOf(routes),
                        encryption: credentials ?? session,
                        previousEncryption: previous,
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
      ),
    ),
  );
}
