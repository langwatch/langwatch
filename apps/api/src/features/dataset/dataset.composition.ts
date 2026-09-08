/**
 * A project's datasets and the batch-evaluation rollups beside them, installed
 * over this process's own graph. `dataset.*` and `datasetRecord.*` read and
 * write the rows themselves; `batchRecord.*` answers the two rollups an
 * experiment's runs are summarised by.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import { datasetServer, type DatasetInfrastructure } from "@langwatch/dataset-server";
import {
  ExperimentApi,
  type ExperimentApi as ExperimentApiContract,
} from "@langwatch/experiment-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp } from "@langwatch/runtime-composition";

import { mountDatasetRest } from "./dataset-rest.mount.ts";
import {
  createBatchRecordTrpcRouter,
  createDatasetRecordTrpcRouter,
  createDatasetTrpcRouter,
} from "./dataset-trpc.mount.ts";
import type { ComposedDatasetFeature } from "./dataset.composition.types.ts";

/** The other features the dataset surface reads through. */
export type DatasetPeers = Readonly<{
  /** The experiment a dataset borrows a name from, and a slug resolves through. */
  experiments: ExperimentApiContract;
  /** How a copy's SECOND project — the source — is checked. */
  permissions: AuthzApiContract;
}>;

/** What the REST family answers through: the door, its envelope and the URLs. */
export type DatasetRestPorts = Readonly<{
  credential: Parameters<typeof mountDatasetRest>[0]["credential"];
  platformUrl: Parameters<typeof mountDatasetRest>[0]["platformUrl"];
  errors: Parameters<typeof mountDatasetRest>[0]["errors"];
}>;

/** Installs the dataset surfaces over this process's own graph. */
export async function installApiDataset(options: {
  prisma: PrismaClient;
  peers: DatasetPeers;
  infrastructure: DatasetInfrastructure;
  rest: DatasetRestPorts;
}): Promise<ComposedDatasetFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({})
    .withProvided(ExperimentApi, options.peers.experiments)
    .withProvided(AuthzApi, options.peers.permissions)
    .withFeature(datasetServer, { infrastructure: options.infrastructure })
    .boot({ role: "api" });

  const app = runtime.feature(datasetServer).provided;

  return {
    routers: (mount) => ({
      dataset: createDatasetTrpcRouter(mount.runtime),
      datasetRecord: createDatasetRecordTrpcRouter(mount.runtime),
      batchRecord: createBatchRecordTrpcRouter(mount.runtime),
    }),
    app,
    rest: mountDatasetRest({ datasets: () => app, ...options.rest }),
  };
}
