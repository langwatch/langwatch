/**
 * A project's datasets and the batch-evaluation rollups beside them, installed
 * over this process's own graph. `dataset.*` and `datasetRecord.*` read and
 * write the rows themselves; `batchRecord.*` answers the two rollups an
 * experiment's runs are summarised by.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { datasetServer, type DatasetInfrastructure } from "@langwatch/dataset-server";
import { HandledError } from "@langwatch/handled-error";
import {
  ExperimentApi,
  type ExperimentApi as ExperimentApiContract,
} from "@langwatch/experiment-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp } from "@langwatch/runtime-composition";

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

/** Installs the dataset surfaces over this process's own graph. */
export async function installApiDataset(options: {
  prisma: PrismaClient;
  peers: DatasetPeers;
  infrastructure: DatasetInfrastructure;
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
  };
}

/**
 * The three dataset namespaces on a process that composed no dataset store.
 * All three still mount and every call refuses by name, so a reader is told
 * the deployment cannot reach their rows rather than shown none.
 */
export function refusingDatasetFeature(): ComposedDatasetFeature {
  const refuse = (): never => {
    throw new ApiDatasetUnavailableError();
  };

  return {
    routers: (mount) => ({
      dataset: createDatasetTrpcRouter(mount.runtime),
      datasetRecord: createDatasetRecordTrpcRouter(mount.runtime),
      batchRecord: createBatchRecordTrpcRouter(mount.runtime),
    }),
    app: new Proxy({} as DatasetApi, { get: () => refuse, has: () => true }),
  };
}

/**
 * A deployment with no dataset store. `fault: "platform"` because nothing the
 * customer sent caused it.
 */
export class ApiDatasetUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment composes no dataset store.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiDatasetUnavailableError";
  }
}
