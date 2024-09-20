import { DEFAULT_DATASET_NAME } from "../../components/datasets/DatasetTable";
import type { Workflow } from "../types/dsl";

export const simpleRagTemplate: Workflow = {
  spec_version: "1.0",
  name: "Simple RAG",
  icon: "🧩",
  description: "Query transformation, vector database search and answer generation",
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
      data: {
        name: "Entry",
        outputs: [
          { identifier: "question", type: "str" },
          { identifier: "gold_answer", type: "str" },
        ],
        dataset: {
          name: DEFAULT_DATASET_NAME,
          inline: {
            records: {
              question: [
                "What is the capital of the moon?",
                "What is the capital france?",
              ],
              gold_answer: [
                "The moon has no capital",
                "The capital of france is Paris",
              ],
            },
            columnTypes: [
              { name: "question", type: "string" },
              { name: "gold_answer", type: "string" },
            ],
          },
        },
      },
    },
    {
      id: "generate_query",
      type: "signature",
      position: { x: 300, y: 300 },
      data: {
        name: "GenerateQuery",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "query", type: "str" }],
      },
    },
    {
      id: "generate_answer",
      type: "signature",
      position: { x: 600, y: 300 },
      data: {
        name: "GenerateAnswer",
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "query", type: "str" },
        ],
        outputs: [{ identifier: "answer", type: "str" }],
      },
    },
  ],
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
  ],
  state: {},
};
