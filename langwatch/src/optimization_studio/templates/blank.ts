import { DEFAULT_DATASET_NAME } from "../../components/datasets/DatasetTable";
import type { End, Entry, Signature, Workflow } from "../types/dsl";

export const entryNode = () => ({
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
    entry_selection: "random",
    train_size: 0.8,
    test_size: 0.2,
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
});

export const blankTemplate: Workflow = {
  spec_version: "1.4",
  name: "Blank Template",
  icon: "🧩",
  description: "Start a new workflow from scratch",
  version: "1.0",
  default_llm: {
    model: "openai/gpt-4o-mini",
    temperature: 0,
    max_tokens: 8192,
  },
  template_adapter: "default",
  workflow_type: "workflow",
  enable_tracing: true,
  nodes: [
    entryNode(),
    {
      id: "llm_call",
      type: "signature",
      position: { x: 300, y: 0 },
      data: {
        name: "LLM Call",
        parameters: [
          {
            identifier: "llm",
            type: "llm",
            value: undefined,
          },
          {
            identifier: "prompting_technique",
            type: "prompting_technique",
            value: undefined,
          },
          {
            identifier: "instructions",
            type: "str",
            value: undefined,
          },
          {
            identifier: "messages",
            type: "chat_messages",
            value: [
              {
                role: "user",
                content: "{{question}}",
              },
            ],
          },
          {
            identifier: "demonstrations",
            type: "dataset",
            value: undefined,
          },
        ],
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
