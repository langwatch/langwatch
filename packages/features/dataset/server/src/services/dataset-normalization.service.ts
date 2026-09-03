import { DatasetNormalizeQueuePort } from "../ports/dataset.port";
import {
  DatasetNormalizationWorkerPort,
  datasetNormalizePayloadSchema,
  type DatasetNormalizePayload,
  type DatasetNormalizationSender,
} from "@langwatch/dataset-contract";
import type { DatasetStorageResolver } from "../ports/dataset-storage.port";
import { DatasetContentRepository } from "../repositories/prisma/dataset-content.repository";
import { createDatasetNormalizeHandler } from "../jobs/dataset-normalize.job";
import { UploadNotPendingError } from "./errors";

/**
 * Process-owned Dataset normalization capability.
 *
 * The service owns both sides of the queue seam: Dataset commands enqueue by
 * aggregate identity, while the worker registers the durable sender and invokes
 * the package-owned handler. With no worker queue, one process-local chain
 * preserves the documented inline fallback without a module-global registry.
 */
export class DatasetNormalizationService
  extends DatasetNormalizeQueuePort
  implements DatasetNormalizationWorkerPort
{
  private readonly processPayload: DatasetNormalizationSender;
  private readonly inlineChains = new Map<string, Promise<void>>();
  private sender: DatasetNormalizationSender | null = null;

  private constructor(
    private readonly datasets: DatasetContentRepository,
    storage: DatasetStorageResolver,
  ) {
    super();
    this.processPayload = createDatasetNormalizeHandler({
      repository: datasets,
      getStorage: (projectId) => storage.forProject(projectId),
    });
  }

  static create(options: {
    datasets: DatasetContentRepository;
    storage: DatasetStorageResolver;
  }): DatasetNormalizationService {
    return new DatasetNormalizationService(options.datasets, options.storage);
  }

  connect(sender: DatasetNormalizationSender): void {
    this.sender = sender;
  }

  process(payload: DatasetNormalizePayload): Promise<void> {
    return this.processPayload(datasetNormalizePayloadSchema.parse(payload));
  }

  async enqueueNormalize(input: { datasetId: string; projectId: string }): Promise<void> {
    const dataset = await this.datasets.findOneOrThrow({
      id: input.datasetId,
      projectId: input.projectId,
    });
    if (!dataset.stagingKey || !dataset.uploadFilename) {
      throw new UploadNotPendingError("Dataset normalization requires a staged upload");
    }
    const payload: DatasetNormalizePayload = {
      id: dataset.id,
      tenantId: input.projectId,
      projectId: input.projectId,
      datasetId: dataset.id,
      stagingKey: dataset.stagingKey,
      filename: dataset.uploadFilename,
    };

    if (this.sender) {
      await this.sender(payload);
      return;
    }
    await this.runInline(payload);
  }

  private runInline(payload: DatasetNormalizePayload): Promise<void> {
    const key = `${payload.projectId}:${payload.datasetId}`;
    const prior = this.inlineChains.get(key) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(() => this.processPayload(payload));
    this.inlineChains.set(key, next);
    void next.finally(() => {
      if (this.inlineChains.get(key) === next) {
        this.inlineChains.delete(key);
      }
    });
    return next;
  }
}
