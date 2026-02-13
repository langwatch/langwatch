import { DEFAULT_FORM_VALUES } from "~/prompts/utils/buildDefaultFormValues";

import type {
  Code,
  Evaluator,
  Field,
  Signature,
} from "./types/dsl";

// Get defaults from the single source of truth
const defaults = DEFAULT_FORM_VALUES.version.configData;
const systemMessage = defaults.messages.find((m) => m.role === "system");
const messages = defaults.messages.filter((m) => m.role !== "system");
const defaultInput = defaults.inputs[0];
const defaultOutput = defaults.outputs[0];

/**
 * Default Empty LLM Signature Node
 *
 * Uses unified defaults from buildDefaultFormValues for consistency across
 * Playground, Evaluations V3, and Optimization Studio.
 */
const signature: Signature = {
  name: "LLM Node",
  description: "LLM calling node",
  parameters: [
    {
      identifier: "llm",
      type: "llm",
      value: {
        model: "openai/gpt-4o",
        temperature: 0,
        max_tokens: 2048,
      },
    },
    {
      identifier: "prompting_technique",
      type: "prompting_technique",
      value: undefined,
    },
    {
      identifier: "instructions",
      type: "str",
      value: systemMessage!.content,
    },
    {
      identifier: "messages",
      type: "chat_messages",
      value: messages,
    },
    {
      identifier: "demonstrations",
      type: "dataset",
      value: undefined,
    },
  ],
  inputs: defaults.inputs.map((i) => ({
    identifier: i.identifier,
    type: i.type,
  })) as Field[],
  outputs: defaults.outputs.map((o) => ({
    identifier: o.identifier,
    type: o.type,
  })) as Field[],
};

const code: Code = {
  name: "Code",
  description: "Python code block",
  parameters: [
    {
      identifier: "code",
      type: "code",
      value: `import dspy

class Code(dspy.Module):
    def forward(self, ${defaultInput?.identifier ?? "input"}: str):
        # Your code goes here

        return {"${defaultOutput?.identifier ?? "output"}": "Hello world!"}
`,
    },
  ],
  inputs: defaults.inputs.map((i) => ({
    identifier: i.identifier,
    type: i.type,
  })) as Field[],
  outputs: defaults.outputs.map((o) => ({
    identifier: o.identifier,
    type: o.type,
  })) as Field[],
};

/**
 * Placeholder evaluator node data for use when dragging a new evaluator
 * onto the canvas before the user has selected the evaluator type in the drawer.
 */
export const EVALUATOR_PLACEHOLDER: Evaluator = {
  cls: "Evaluator",
  name: "Evaluator",
  description: "Drag to canvas to create an evaluator via the evaluator editor",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "passed", type: "bool" }],
};

export const MODULES = {
  signature,
  code,
};
