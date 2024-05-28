import { z } from "zod";
import {
  datasetSpanSchema,
  chatMessageSchema,
} from "../tracer/types.generated";

export type OneMessagePerRowColumns =
  | "input"
  | "expected_output"
  | "contexts"
  | "spans";

export type OneLLMCallPerRowColumns = "llm_input" | "expected_llm_output";

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

export const newDatasetEntriesSchema = z.union([
  z.object({
    schema: z.literal("ONE_MESSAGE_PER_ROW"),
    entries: z.array(
      z.object({
        id: z.string(),
        input: z.string().optional(),
        expected_output: z.string().optional(),
        spans: z.array(datasetSpanSchema).optional(),
        contexts: z.array(z.string()).optional(),
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
};
