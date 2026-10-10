import {
  DATASET_NORMALIZATION_EVENT_VERSION,
  DATASET_NORMALIZATION_SETTLED_EVENT_TYPE,
  datasetNormalizationSettledEventDataSchema,
  datasetNormalizePayloadSchema,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

import type { DatasetNormalize } from "../app/dataset.app.ts";

/** One aggregate per dataset, so one normalize runs per dataset at once. */
export const DATASET_AGGREGATE_TYPE = "dataset" as const;

const SCHEMA = defineCommandSchema(
  "lw.dataset.dataset.normalize",
  datasetNormalizePayloadSchema,
  "Normalizes one imported file into the dataset's chunked content",
);

export const datasetNormalizationSettledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DATASET_NORMALIZATION_SETTLED_EVENT_TYPE),
  version: z.literal(DATASET_NORMALIZATION_EVENT_VERSION),
  data: datasetNormalizationSettledEventDataSchema,
});
type DatasetNormalizationSettledEvent = z.infer<typeof datasetNormalizationSettledEventSchema>;

/**
 * Main's `datasetNormalize` job: grouped by dataset. States where the dataset came to rest, so
 * its reads refresh (WEB-5150); a failed run throws first and its retry states `failed`.
 */
export class DatasetNormalizeCommandHandler implements CommandHandler<
  Command<DatasetNormalizePayload>,
  DatasetNormalizationSettledEvent
> {
  static readonly schema = SCHEMA;

  static create(deps: { normalize: DatasetNormalize }): DatasetNormalizeCommandHandler {
    return new DatasetNormalizeCommandHandler(deps.normalize);
  }

  private constructor(private readonly normalize: DatasetNormalize) {}

  static getAggregateId(payload: DatasetNormalizePayload): string {
    return payload.datasetId;
  }

  static getSpanAttributes(
    payload: DatasetNormalizePayload,
  ): Record<string, string | number | boolean> {
    return { "payload.projectId": payload.projectId, "payload.datasetId": payload.datasetId };
  }

  async handle(
    command: Command<DatasetNormalizePayload>,
  ): Promise<DatasetNormalizationSettledEvent[]> {
    const { projectId, datasetId } = command.data;
    const status = await this.normalize.normalize(command.data);
    if (status === "skipped") return [];
    return [
      EventUtils.createEvent<DatasetNormalizationSettledEvent>({
        aggregateType: DATASET_AGGREGATE_TYPE,
        aggregateId: datasetId,
        tenantId: createTenantId(command.tenantId),
        type: DATASET_NORMALIZATION_SETTLED_EVENT_TYPE,
        version: DATASET_NORMALIZATION_EVENT_VERSION,
        data: { projectId, datasetId, status },
      }),
    ];
  }
}
