import { z } from "zod";
import {
  datasetSpanSchema,
  chatMessageSchema,
  rAGChunkSchema,
} from "../tracer/types.generated";

export type OneMessagePerRowColumns =
  | "input"
  | "expected_output"
  | "contexts"
  | "spans"
  | "comments"
  | "annotation_scores"
  | "evaluations";

export type OneLLMCallPerRowColumns =
  | "llm_input"
  | "expected_llm_output"
  | "comments"
  | "annotation_scores"
  | "evaluations";

export type DatasetColumns = OneMessagePerRowColumns & OneLLMCallPerRowColumns;

export type DatasetRecordForm = {
  /**
   * @minLength 1
   */
  name: string;
} & (
  | {
      schema: "ONE_MESSAGE_PER_ROW";
      columns: OneMessagePerRowColumns[];
    }
  | {
      schema: "ONE_LLM_CALL_PER_ROW";
      columns: OneLLMCallPerRowColumns[];
    }
);

export const annotationScoreSchema = z.object({
  label: z.string().optional(),
  value: z.string().optional(),
  reason: z.string().optional(),
  name: z.string().optional(),
  traceId: z.string().optional(),
});

export const evaluationsSchema = z.object({
  evaluation_name: z.string(),
  evaluation_type: z.string(),
  passed: z.boolean().nullable(),
  score: z.number().nullable(),
});

export const newDatasetEntriesSchema = z.union([
  z.object({
    schema: z.literal("ONE_MESSAGE_PER_ROW"),
    entries: z.array(
      z.object({
        id: z.string(),
        input: z.string().optional(),
        expected_output: z.string().optional(),
        spans: z.array(datasetSpanSchema).optional(),
        contexts: z
          .union([z.array(rAGChunkSchema), z.array(z.string())])
          .optional(),
        comments: z.string().optional(),
        annotation_scores: z.array(annotationScoreSchema).optional(),
        evaluations: z.array(evaluationsSchema).optional(),
      })
    ),
  }),
  z.object({
    schema: z.literal("ONE_LLM_CALL_PER_ROW"),
    entries: z.array(
      z.object({
        id: z.string(),
        llm_input: z.array(chatMessageSchema).optional(),
        expected_llm_output: z.array(chatMessageSchema).optional(),
        comments: z.string().optional(),
        annotation_scores: z.array(annotationScoreSchema).optional(),
        evaluations: z.array(evaluationsSchema).optional(),
      })
    ),
  }),
]);

export type FlattenStringifiedDatasetEntry = {
  id: string;
  selected: boolean;
  input?: string;
  expected_output?: string;
  spans?: string;
  contexts?: string;
  llm_input?: string;
  expected_llm_output?: string;
  comments?: string;
  annotation_scores?: string;
  evaluations?: string;
};
