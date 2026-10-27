/**
 * Records which dataset version a run read, so the dataset keeps that version
 * out of retention and the run can show it. Spec:
 * modules/dataset/specs/dataset-versioning.feature, "Experiments".
 */
import type { DatasetApi } from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";

import type { LoadedDatasetVersion } from "./experiment-execution-data.service.ts";

const logger = createLogger("langwatch:experiment:run-dataset-version");

export class ExperimentRunDatasetVersionService {
  private constructor(private readonly datasets: Pick<DatasetApi, "linkRunVersions">) {}

  static create({
    datasets,
  }: {
    datasets: Pick<DatasetApi, "linkRunVersions">;
  }): ExperimentRunDatasetVersionService {
    return new ExperimentRunDatasetVersionService(datasets);
  }

  /** Links the version to the run; a failed link is logged and never fails the run. */
  async link({
    projectId,
    runId,
    experimentId,
    datasetVersion,
  }: {
    projectId: string;
    runId: string;
    experimentId: string | null;
    datasetVersion: LoadedDatasetVersion | undefined;
  }): Promise<void> {
    if (!datasetVersion) return;
    try {
      await this.datasets.linkRunVersions({
        projectId,
        runId,
        experimentId: experimentId === "" ? null : experimentId,
        versions: [{ datasetId: datasetVersion.datasetId, versionId: datasetVersion.versionId }],
      });
    } catch (error) {
      logger.error(
        { error, projectId, runId, datasetId: datasetVersion.datasetId },
        "Failed to link the run to its dataset version",
      );
    }
  }
}
