/**
 * The generated Prisma shapes this family's screens name, without the generated client.
 */

import {
  EXPERIMENT_TYPES,
  type ExperimentType as ExperimentTypeName,
} from "@langwatch/experiment-contract";

export const ExperimentType = Object.fromEntries(EXPERIMENT_TYPES.map((name) => [name, name])) as {
  readonly [K in ExperimentTypeName]: K;
};

export type ExperimentType = ExperimentTypeName;

/**
 * One row of a batch evaluation run, as the batch surface reads it.
 */
export type BatchEvaluation = {
  dataset: { name: string };
  id: string;
  experimentId: string;
  projectId: string;
  data: unknown;
  status: string;
  score: number;
  label: string | null;
  passed: boolean;
  details: string;
  cost: number;
  datasetSlug: string;
  datasetId: string;
  evaluation: string;
  createdAt: Date;
  updatedAt: Date;
};
