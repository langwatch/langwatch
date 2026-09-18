import type { ScopedSecrets } from "@langwatch/secrets";

import { storesOwner, type StoresConfig } from "./config-owner.ts";
import { createProcessMembers, type ProcessMemberSource } from "./create-members.ts";
import type { PipelineParticipation } from "./pipeline-selection.ts";

/** Connection values remain inside the construction closure; only opened members escape. */
export function openProcessStores(
  name: string,
  config: StoresConfig,
  secrets: ScopedSecrets,
  pipelines: PipelineParticipation,
): Promise<ProcessMemberSource> {
  return secrets.into(storesOwner.secrets.database, (database) =>
    secrets.into(storesOwner.secrets.clickhouse, (clickhouse) =>
      secrets.into(storesOwner.secrets.redis, (redis) =>
        secrets.into(storesOwner.secrets.encryption, (encryption) =>
          createProcessMembers({
            config: {
              processName: name,
              encryptionKey: encryption ?? "",
              secrets: {},
              rateLimit: config.rateLimit,
              mail: { provider: "off" },
              ...(database ? { database: { url: database } } : {}),
              ...(clickhouse ? { clickhouse: { url: clickhouse } } : {}),
              ...(redis ? { redis: { url: redis } } : {}),
              eventing: pipelines.configure(config.defaultRetentionDays),
            },
          }),
        ),
      ),
    ),
  );
}
