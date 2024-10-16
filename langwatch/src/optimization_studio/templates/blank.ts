import { DEFAULT_DATASET_NAME } from "../../components/datasets/DatasetTable";
import type { End, Entry, Signature, Workflow } from "../types/dsl";

export const blankTemplate: Workflow = {
  spec_version: "1.0",
  name: "Blank Template",
  icon: "🧩",
  description: "Start a new workflow from scratch",
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
      position: {
        x: 0,
        y: 0,
      },
      deletable: false,
      data: {
        name: "Entry",
        outputs: [{ identifier: "question", type: "str" }],
        entry_selection: "first",
        train_test_split: 0.2,
        seed: 42,
        dataset: {
          name: DEFAULT_DATASET_NAME,
          inline: {
            records: {
              question: ["Hello world"],
            },
            columnTypes: [{ name: "question", type: "string" }],
          },
        },
      } satisfies Entry,
    },
    {
      id: "llm_call",
      type: "signature",
      position: { x: 300, y: 0 },
      data: {
        name: "LLM Call",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      } satisfies Signature,
    },
    {
      id: "end",
      type: "end",
      position: { x: 600, y: 30 },
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
      target: "llm_call",
      targetHandle: "inputs.question",
      type: "default",
    },
    {
      id: "e1-2",
      source: "llm_call",
      sourceHandle: "outputs.answer",
      target: "end",
      targetHandle: "inputs.output",
      type: "default",
    },
  ],
  state: {},
};
