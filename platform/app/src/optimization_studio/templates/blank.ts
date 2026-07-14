const DEFAULT_DATASET_NAME = "Draft Dataset";

import { DEFAULT_MODEL } from "../../utils/constants";
import type { End, Entry, Signature, Workflow } from "../types/dsl";
import { DEFAULT_MAX_TOKENS } from "../utils/registryUtils";

export const entryNode = () => ({
  id: "entry",
  type: "entry",
  position: {
    x: 0,
    y: 0,
  },
  deletable: false,
  data: {
    name: "Entry point",
    outputs: [{ identifier: "input", type: "str" }],
    entry_selection: "random",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
    dataset: {
      name: DEFAULT_DATASET_NAME,
      inline: {
        records: {
          input: ["Hello world"],
        },
        columnTypes: [{ name: "input", type: "string" }],
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
    model: DEFAULT_MODEL,
    // Temperature omitted - reasoning models don't support temperature (uses reasoning_effort instead)
    max_tokens: DEFAULT_MAX_TOKENS,
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
            // Mirrors the default new-prompt shape (buildDefaultFormValues),
            // so a fresh workflow opens with a runnable prompt instead of an
            // empty-messages error.
            identifier: "instructions",
            type: "str",
            value: "You are a helpful assistant.",
          },
          {
            identifier: "messages",
            type: "chat_messages",
            value: [
              {
                role: "user",
                content: "{{input}}",
              },
            ],
          },
          {
            identifier: "demonstrations",
            type: "dataset",
            value: undefined,
          },
        ],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
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
      sourceHandle: "outputs.input",
      target: "llm_call",
      targetHandle: "inputs.input",
      type: "default",
    },
    {
      id: "e1-2",
      source: "llm_call",
      sourceHandle: "outputs.output",
      target: "end",
      targetHandle: "inputs.output",
      type: "default",
    },
  ],
  state: {},
};
