import type { DatasetNormalizePayload } from "@langwatch/dataset-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { DatasetModule, DatasetNormalize } from "../app/dataset.app.ts";
import type { DatasetRepositories } from "../repositories/dataset.repositories.ts";
import { DatasetNormalizeCommandHandler } from "./dataset-normalize.commands.ts";

export const DATASET_NORMALIZATION_PIPELINE_NAME = "dataset_normalization";

export type DatasetNormalizationDefinition = StaticPipelineDefinition<
  never,
  Record<string, Projection>,
  { name: "datasetNormalize"; payload: DatasetNormalizePayload }
>;

/** Replaces main's standalone `datasetNormalize` GroupQueue job: a command with no events. */
export function buildDatasetNormalizationPipeline(deps: {
  normalize: DatasetNormalize;
}): DatasetNormalizationDefinition {
  return definePipeline({
    name: DATASET_NORMALIZATION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "dataset" }),
  })
    .withEvents([])
    .withCommandInstance({
      name: "datasetNormalize",
      handlerClass: DatasetNormalizeCommandHandler,
      instance: DatasetNormalizeCommandHandler.create(deps),
      options: {},
    })
    .build();
}

export const datasetNormalizationEventing = defineEventingModule({
  pipeline: DATASET_NORMALIZATION_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DatasetRepositories, DatasetModule>) =>
    app.normalizationPipeline(),
  connect: ({ app, commands }) => app.connectNormalization(commands.datasetNormalize),
});
