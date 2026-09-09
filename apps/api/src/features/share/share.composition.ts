/**
 * The links a project shares outside itself, composed as their own feature. `share.*`
 * administers the links; `pinnedTrace.*` is the same ledger read as the traces a person
 * kept.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  type DataRetentionApi as DataRetentionApiContract,
} from "@langwatch/data-retention-contract";
import { createApp } from "@langwatch/runtime-composition";
import { shareServer, type ShareInfrastructure } from "@langwatch/share-server";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createPinnedTraceTrpcRouter, createShareTrpcRouter } from "./share-trpc.mount.ts";
import type { ComposedShareFeature } from "./share.composition.types.ts";

/** The other features' apps a share link is bounded and authorized by. */
export type SharePeers = Readonly<{
  /** The window a shared trace stays readable inside, and the pin a live link holds. */
  dataRetention: DataRetentionApiContract;
  /** Decides an audience, and records the grant a share hands its viewer. */
  permissions: AuthzApiContract;
}>;

/** Installs the share surfaces over this process's own graph. */
export async function installApiShare(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: SharePeers;
  /** The viewer cache; `null` runs the ledger uncached. */
  redis: ShareInfrastructure["redis"];
}): Promise<ComposedShareFeature> {
  const { prisma } = options.infrastructure;
  const { dataRetention, permissions } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(DataRetentionApi, dataRetention)
    .withProvided(AuthzApi, permissions)
    .withModule(shareServer, { infrastructure: { redis: options.redis } })
    .boot({ role: "api" });

  const app = runtime.module(shareServer).provided;

  return {
    routers: (mount) => ({
      share: createShareTrpcRouter(mount.runtime),
      pinnedTrace: createPinnedTraceTrpcRouter(mount.runtime),
    }),
    app,
  };
}
