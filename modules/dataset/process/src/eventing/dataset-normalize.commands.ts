import {
  datasetNormalizePayloadSchema,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { defineCommandSchema } from "@langwatch/eventing";

import type { DatasetNormalize } from "../app/dataset.app.ts";

const SCHEMA = defineCommandSchema(
  "lw.dataset.dataset.normalize",
  datasetNormalizePayloadSchema,
  "Normalizes one imported file into the dataset's chunked content",
);

/** Main's `datasetNormalize` job: grouped by dataset, so one normalize runs per dataset at once. */
export class DatasetNormalizeCommandHandler implements CommandHandler<
  Command<DatasetNormalizePayload>,
  never
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

  async handle(command: Command<DatasetNormalizePayload>): Promise<never[]> {
    await this.normalize.normalize(command.data);

    return [];
  }
}
