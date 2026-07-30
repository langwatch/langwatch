import { evaluationReportedDataSchema, evaluationStartedDataSchema } from "./schema";

/**
 * `prefix` keeps the derived type strings byte-equal to `lw.evaluation.started`
 * / `lw.evaluation.reported`, already in `event_log`.
 */
export const EVALUATION_PIPELINE_NAME = "evaluation";
export const EVALUATION_PIPELINE_PREFIX = "lw";

export const evaluationEvents = {
  started: evaluationStartedDataSchema,
  reported: evaluationReportedDataSchema,
} as const;
