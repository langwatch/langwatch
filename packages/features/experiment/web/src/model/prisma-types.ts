/**
 * The generated Prisma shapes this family's screens name, without the
 * generated client.
 *
 * `~/generated/prisma/client` is the application's own generated client and a
 * browser package may not reach it. `@langwatch/workflow-web/model/prisma-types`
 * already answers for `Project` and `Experiment`, which is why only two names
 * are here.
 *
 * `ExperimentType` IS DERIVED RATHER THAN RESTATED, and that is the difference
 * worth keeping: `@langwatch/experiment-contract` already publishes the enum's
 * MEMBERS (`EXPERIMENT_TYPES`) and its type, but not a value object — and the
 * four screens read it as `ExperimentType.EVALUATIONS_V3`. Building the object
 * out of the contract's own tuple means a value added to the schema and the
 * contract cannot go missing here, which a hand-written copy could.
 * `BatchEvaluation` is a genuine restatement, and carries the alignment
 * obligation every other `prisma-types` in the repository states: it must stay
 * identical to `schema.prisma` or a batch result renders a column that is not
 * there.
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
 *
 * `dataset` is the relation the procedure includes, not a schema column, and
 * only its name is read — the row's heading says which dataset the run was over.
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
