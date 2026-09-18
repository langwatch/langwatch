import type { TransportSelection } from "@langwatch/api/hosting";
import type { TransportPeers, ExposedSurface } from "@langwatch/kernel";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import type { ScopedSecrets } from "@langwatch/secrets";

import { apiSurface, bearerDoor } from "./api-surface.ts";
import { resolveUiBundle } from "./bundle-config.ts";
import { apiOwner, type ApiHostConfig } from "./config-owner.ts";

export async function processSurface(
  config: ApiHostConfig,
  production: boolean,
  executionProxyBaseUrl: string | undefined,
  members: ProcessMemberSource,
  secrets: ScopedSecrets,
  selection: TransportSelection,
  publicConfig: Readonly<Record<string, unknown>>,
): Promise<(peers: TransportPeers) => ExposedSurface<unknown, unknown>> {
  const bundle = resolveUiBundle({
    directory: config.bundleDirectory,
    assetBase: config.assetBase,
    publicConfig,
  });
  const cron = await secrets.into(apiOwner.secrets.cron, (token) =>
    bearerDoor({ name: "cron", token }),
  );
  const instanceAdmin = await secrets.into(apiOwner.secrets.instanceAdmin, (token) =>
    bearerDoor({ name: "instance-admin", token }),
  );
  return apiSurface({
    members,
    logger: members.read("logger"),
    stores: { database: true, redis: true },
    bundle,
    storage: {},
    internalBearers: new Map([["cron", cron]]),
    instanceAdmin,
    trustedProxies: config.trustedProxies,
    executionProxyBaseUrl,
    production,
    selection,
  });
}
