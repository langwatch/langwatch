import type { DatasetApi } from "@langwatch/dataset-contract";
import type {
  DatasetEvaluationRow,
  EvaluationSlugLookup,
  EvaluationSlugMatch,
} from "@langwatch/evaluation-contract";

/** The dataset a dataset evaluation names by slug, and the rows it records, through their owner. */
export class EvaluationDatasetLookupService {
  private constructor(
    private readonly datasets: Pick<DatasetApi, "findBySlug" | "createBatchEvaluation">,
  ) {}

  static create(
    datasets: Pick<DatasetApi, "findBySlug" | "createBatchEvaluation">,
  ): EvaluationDatasetLookupService {
    return new EvaluationDatasetLookupService(datasets);
  }

  async findDatasetBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null> {
    const [dataset] = await this.datasets.findBySlug({
      projectId: input.projectId,
      slug: input.slug,
    });

    return dataset ? { id: dataset.id } : null;
  }

  recordDatasetRow(input: DatasetEvaluationRow): Promise<void> {
    return this.datasets.createBatchEvaluation(input);
  }
}
