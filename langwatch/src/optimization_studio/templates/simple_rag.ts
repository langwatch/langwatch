import { DEFAULT_DATASET_NAME } from "../../components/datasets/DatasetTable";
import type { End, Entry, Evaluator, Workflow } from "../types/dsl";

export const simpleRagTemplate: Workflow = {
  spec_version: "1.0",
  name: "Simple RAG",
  icon: "🧩",
  description:
    "Query transformation, vector database search and answer generation",
  version: "1.0",
  default_llm: {
    model: "openai/gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  },
  nodes: [
    {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      deletable: false,
      data: {
        name: "Entry",
        outputs: [
          { identifier: "question", type: "str" },
          { identifier: "gold_answer", type: "str" },
        ],
        entry_selection: "first",
        train_test_split: 0.2,
        seed: 42,
        dataset: {
          name: DEFAULT_DATASET_NAME,
          inline: {
            records: {
              question: [
                "What is the capital of the moon?",
                "What is the capital france?",
              ],
              gold_answer: ["The moon has no capital", "Paris"],
            },
            columnTypes: [
              { name: "question", type: "string" },
              { name: "gold_answer", type: "string" },
            ],
          },
        },
      } satisfies Entry,
    },
    {
      id: "generate_query",
      type: "signature",
      position: { x: 300, y: 0 },
      data: {
        name: "GenerateQuery",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "query", type: "str" }],
      },
    },
    {
      id: "generate_answer",
      type: "signature",
      position: { x: 600, y: 0 },
      data: {
        name: "GenerateAnswer",
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "query", type: "str" },
        ],
        outputs: [{ identifier: "answer", type: "str" }],
      },
    },
    {
      id: "exact_match",
      type: "evaluator",
      position: { x: 900, y: 300 },
      data: {
        name: "ExactMatch",
        cls: "ExactMatchEvaluator",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
        ],
      } satisfies Evaluator,
    },
    {
      id: "end",
      type: "end",
      position: { x: 900, y: 0 },
      deletable: false,
      data: {
        name: "End",
        inputs: [{ identifier: "output", type: "str" }],
      } satisfies End,
    },
  ] satisfies Workflow["nodes"],
  edges: [
    {
      id: "e0-1",
      source: "entry",
      sourceHandle: "outputs.question",
      target: "generate_query",
      targetHandle: "inputs.question",
      type: "default",
    },
    {
      id: "e1-2",
      source: "generate_query",
      sourceHandle: "outputs.query",
      target: "generate_answer",
      targetHandle: "inputs.query",
      type: "default",
    },
    {
      id: "e2-3",
      source: "entry",
      sourceHandle: "outputs.question",
      target: "generate_answer",
      targetHandle: "inputs.question",
      type: "default",
    },
    {
      id: "e3-4",
      source: "generate_answer",
      sourceHandle: "outputs.answer",
      target: "end",
      targetHandle: "inputs.output",
      type: "default",
    },
    {
      id: "e4-5",
      source: "entry",
      sourceHandle: "outputs.gold_answer",
      target: "exact_match",
      targetHandle: "inputs.expected_output",
      type: "default",
    },
    {
      id: "e5-6",
      source: "generate_answer",
      sourceHandle: "outputs.answer",
      target: "exact_match",
      targetHandle: "inputs.output",
      type: "default",
    },
  ],
  state: {},
};
