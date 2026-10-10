import type { DatasetNormalizePayload } from "@langwatch/dataset-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { z } from "zod";

import type { DatasetModule, DatasetNormalize } from "../app/dataset.app.ts";
import type { DatasetRepositories } from "../repositories/dataset.repositories.ts";
import {
  DATASET_AGGREGATE_TYPE,
  DatasetNormalizeCommandHandler,
  datasetNormalizationSettledEventSchema,
} from "./dataset-normalize.commands.ts";

const DATASET_NORMALIZATION_PIPELINE_NAME = "dataset_normalization";

export type DatasetNormalizationDefinition = StaticPipelineDefinition<
  z.infer<typeof datasetNormalizationSettledEventSchema>,
  Record<string, Projection>,
  { name: "datasetNormalize"; payload: DatasetNormalizePayload }
>;

/** Replaces main's standalone `datasetNormalize` GroupQueue job; states where a dataset settled. */
export function buildDatasetNormalizationPipeline(deps: {
  normalize: DatasetNormalize;
}): DatasetNormalizationDefinition {
  return (
    definePipeline({
      name: DATASET_NORMALIZATION_PIPELINE_NAME,
      aggregate: defineAggregate({ type: DATASET_AGGREGATE_TYPE }),
    })
      .withEvents([datasetNormalizationSettledEventSchema])
      .withCommandInstance({
        name: "datasetNormalize",
        handlerClass: DatasetNormalizeCommandHandler,
        instance: DatasetNormalizeCommandHandler.create(deps),
        options: {},
      })
      // Main queued it on the trace pipeline; its payload is the command's, staging-key form too.
      .withLaneAliases([
        {
          from: "trace_processing:job:datasetNormalize",
          to: { jobType: "command", lane: "datasetNormalize" },
          removeAfter: "3.21.0",
        },
      ])
      .build()
  );
}

export const datasetNormalizationEventing = defineEventingModule({
  pipeline: DATASET_NORMALIZATION_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DatasetRepositories, DatasetModule>) =>
    app.normalizationPipeline(),
  connect: ({ app, commands }) => app.connectNormalization(commands.datasetNormalize),
});
