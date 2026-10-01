/**
 * The experiments a project lists, and the one a lookup names by id or slug.
 * Spec: modules/experiment/specs/experiment-service.feature.
 */
import type { Dataset, DatasetApi } from "@langwatch/dataset-contract";
import {
  ExperimentIdOrSlugRequiredError,
  isLegacyOnlineEvaluationWorkbenchState,
  type Experiment,
  type ExperimentEvaluationsListInput,
  type ExperimentEvaluationsListPage,
  type ExperimentIdOrSlugInput,
} from "@langwatch/experiment-contract";

import { extractDatasetId, pickLatestRun } from "../rules/experiment-evaluations-list.rules.ts";
import type { ExperimentWorkflowLinkService } from "./experiment-workflow-link.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

export type ExperimentListingServiceOptions = {
  experiments: Pick<ExperimentService, "getById" | "getBySlug" | "list" | "listRuns">;
  links: Pick<ExperimentWorkflowLinkService, "findWorkflow">;
  dataset: Pick<DatasetApi, "getByIds">;
};

export class ExperimentListingService {
  static create(options: ExperimentListingServiceOptions): ExperimentListingService {
    return new ExperimentListingService(options);
  }

  private constructor(private readonly options: ExperimentListingServiceOptions) {}

  async getByIdOrSlug(input: ExperimentIdOrSlugInput): Promise<Experiment> {
    if (input.experimentId) {
      return this.options.experiments.getById({
        projectId: input.projectId,
        id: input.experimentId,
      });
    }
    if (input.experimentSlug) {
      return this.options.experiments.getBySlug({
        projectId: input.projectId,
        slug: input.experimentSlug,
      });
    }

    throw new ExperimentIdOrSlugRequiredError();
  }

  async listForEvaluations(
    input: ExperimentEvaluationsListInput,
  ): Promise<ExperimentEvaluationsListPage> {
    const pageOffset = input.pageOffset ?? 0;
    const pageSize = input.pageSize ?? 25;

    // Every active experiment with its workflow join, then filter and paginate
    // in memory: JSON-path filtering on `task` inside `workbenchState` is
    // unreliable, so the count and the page slice run off the same array.
    const allExperiments = await Promise.all(
      (await this.options.experiments.list({ projectId: input.projectId })).map(
        async (experiment) => ({
          ...experiment,
          workflow: experiment.workflowId
            ? await this.options.links.findWorkflow({
                id: experiment.workflowId,
                projectId: input.projectId,
                includeVersion: true,
              })
            : null,
        }),
      ),
    );
    const nonLegacyExperiments = allExperiments.filter(
      (experiment) => !isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState),
    );
    const totalHits = nonLegacyExperiments.length;

    // Pagination is applied after excluding legacy online evaluations.
    const pagedExperiments = nonLegacyExperiments.slice(pageOffset, pageOffset + pageSize);

    const datasetIds = pagedExperiments
      .map((experiment) => extractDatasetId(experiment.workflow?.currentVersion?.dsl))
      .filter((id): id is string => !!id);

    const datasetsById = Object.fromEntries(
      (await this.options.dataset.getByIds({ projectId: input.projectId, datasetIds })).map(
        (dataset: Dataset) => [dataset.id, { id: dataset.id, name: dataset.name }],
      ),
    );

    const runsByExperimentId = await this.options.experiments.listRuns({
      projectId: input.projectId,
      experimentIds: pagedExperiments.map((experiment) => experiment.id),
    });

    const experimentsWithDatasetsAndRuns = pagedExperiments
      .map((experiment) => {
        const runs = runsByExperimentId[experiment.id] ?? [];
        const latestRun = pickLatestRun(runs);
        const primaryMetric = latestRun
          ? Object.values(latestRun.summary.evaluations)[0]
          : undefined;

        return {
          ...experiment,
          runsSummary: {
            count: runs.length,
            primaryMetric,
            latestRun: { timestamps: latestRun?.timestamps },
          },
          dataset: datasetsById[extractDatasetId(experiment.workflow?.currentVersion?.dsl) ?? ""],
          updatedAt: latestRun?.timestamps.createdAt ?? experiment.updatedAt.getTime(),
        };
      })
      .toSorted((a, b) => b.updatedAt - a.updatedAt);

    return { experiments: experimentsWithDatasetsAndRuns, totalHits };
  }
}
