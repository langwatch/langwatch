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
