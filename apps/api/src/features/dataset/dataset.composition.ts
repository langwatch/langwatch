/**
 * A project's datasets and the batch-evaluation rollups beside them, composed as their
 * own feature. `dataset.*` reads and writes the rows themselves; `batchRecord.*` answers
 * the two rollups an experiment's runs are summarised by.
 */
import type { DatasetService } from "@langwatch/dataset-contract";
import {
  DatasetApp,
  PostgresDatasetAdapter,
  type BatchRecordTrpcPorts,
  type DatasetExperimentLookup,
  type DatasetTrpcPorts,
} from "@langwatch/dataset-server";
import { HandledError } from "@langwatch/handled-error";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createBatchRecordTrpcRouter, createDatasetTrpcRouter } from "./dataset-trpc.mount";

/**
 * The ONE dataset service on this process.
 */
export function composeDatasetService(options: {
  infrastructure: ApiTrpcInfrastructure;
}): DatasetService {
  return PostgresDatasetAdapter.create({ database: options.infrastructure.prisma }).build();
}

/** The other features' services the dataset surface reaches, named one by one. */
export type DatasetPeers = Readonly<{
  /**
   * The dataset service the execution half already composed.
   */
  datasets: DatasetService;
  /** The experiment lookup a dataset resolves a borrowed name through. */
  experimentLookup: DatasetExperimentLookup;
}>;

/** The two namespaces and the `ctx.app.dataset` slice the REST family reads. */
export type ComposedDatasetFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    dataset: ReturnType<typeof createDatasetTrpcRouter>;
    batchRecord: ReturnType<typeof createBatchRecordTrpcRouter>;
  };
  /** For `ctx.app.dataset`. */
  app: DatasetApp;
}>;

/** Composes the dataset surface over this process's own graph. */
export function composeDatasetFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: DatasetPeers;
}): ComposedDatasetFeature {
  const { prisma, authz } = options.infrastructure;

  const app = DatasetApp.create({
    dataset: options.peers.datasets,
    experiments: options.peers.experimentLookup,
  });

  const dataset: DatasetTrpcPorts = {
    /**
     * A copy reads a SECOND project — the source — that the declared check on the
     * procedure never covered, so the source is probed separately before anything is read
     * from it. Answered by the one AuthZ service this process authorizes with.
     */
    probeProjectPermission: (ctx, projectId, permission) =>
      authz.hasPermission({
        userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
        permission,
        projectId,
      }),
  };

  const batchRecord: BatchRecordTrpcPorts<unknown, unknown> = {
    summariseByExperiment: (_ctx, { projectId }) =>
      prisma.batchEvaluation.groupBy({
        by: ["experimentId", "datasetSlug"],
        where: { projectId },
        _count: { experimentId: true },
        _sum: { cost: true },
        _avg: { score: true },
      }),
    listByExperiment: (_ctx, { projectId, experimentId }) =>
      prisma.batchEvaluation.findMany({
        where: { projectId, experimentId },
        include: { dataset: true },
      }),
  };

  return {
    routers: (mount) => ({
      dataset: createDatasetTrpcRouter({ ...mount, ports: dataset }),
      batchRecord: createBatchRecordTrpcRouter({ ...mount, ports: batchRecord }),
    }),
    app,
  };
}

/**
 * The dataset surfaces on a process that composed no graph to read them over.
 */
export function refusingDatasetFeature(): ComposedDatasetFeature {
  const refuse = (): never => {
    throw new ApiDatasetUnavailableError();
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    routers: (mount) => ({
      dataset: createDatasetTrpcRouter({ ...mount, ports: refuseEvery<DatasetTrpcPorts>() }),
      batchRecord: createBatchRecordTrpcRouter({
        ...mount,
        ports: refuseEvery<BatchRecordTrpcPorts<unknown, unknown>>(),
      }),
    }),
    app: refuseEvery<DatasetApp>(),
  };
}

/** The dataset store reached on a process that composed none. */
class ApiDatasetUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "The dataset store is not available on this deployment.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiDatasetUnavailableError";
  }
}
