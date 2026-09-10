import {
  DatasetNormalizationWorker,
  datasetNormalizePayloadSchema,
  type DatasetNormalizePayload,
  type DatasetNormalizationSender,
} from "@langwatch/dataset-contract";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import { DatasetNormalizeQueue, type DatasetNormalize } from "../app/dataset.app.ts";
import { UploadNotPendingError } from "@langwatch/dataset-contract";

/**
 * Process-owned Dataset normalization capability. Owns both sides of the
 * queue seam: commands enqueue by aggregate identity, and the worker
 * registers the durable sender that invokes the package-owned handler.
 */
export class DatasetNormalizationService
  implements DatasetNormalizeQueue, DatasetNormalizationWorker
{
  private readonly inlineChains = new Map<string, Promise<void>>();
  private sender: DatasetNormalizationSender | null = null;

  private constructor(
    private readonly datasets: DatasetContentRepository,
    private readonly normalize: DatasetNormalize,
  ) {}

  static create(options: {
    datasets: DatasetContentRepository;
    normalize: DatasetNormalize;
  }): DatasetNormalizationService {
    return new DatasetNormalizationService(options.datasets, options.normalize);
  }

  connect(sender: DatasetNormalizationSender): void {
    this.sender = sender;
  }

  process(payload: DatasetNormalizePayload): Promise<void> {
    return this.normalize.normalize(datasetNormalizePayloadSchema.parse(payload));
  }

  async enqueueNormalize(input: { datasetId: string; projectId: string }): Promise<void> {
    const dataset = await this.datasets.getOne({
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
    const next = prior.catch(() => undefined).then(() => this.normalize.normalize(payload));
    this.inlineChains.set(key, next);
    void next.finally(() => {
      if (this.inlineChains.get(key) === next) {
        this.inlineChains.delete(key);
      }
    });

    return next;
  }
}
