import type { End, Entry, Signature, Workflow } from "../types/dsl";
import { DEFAULT_MAX_TOKENS } from "../utils/registryUtils";

export const entryNode = () => ({
  id: "entry",
  type: "entry",
  // x is offset so the gap to the sample node matches the sample -> end gap:
  // the sample node is wider than entry, so equal left-edge spacing would
  // leave a visibly larger gap on the entry side.
  position: {
    x: 84,
    y: 0,
  },
  deletable: false,
  data: {
    name: "Entry point",
    outputs: [{ identifier: "question", type: "str" }],
    entry_selection: "random",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
  } satisfies Entry,
});

export const customEvaluatorTemplate: Workflow = {
  spec_version: "1.4",
  name: "Custom Evaluator",
  icon: "✅",
  description: "Create a custom evaluator to be used in other workflows",
  version: "1.0",
  default_llm: {
    model: "openai/gpt-5",
    temperature: 1,
    max_tokens: DEFAULT_MAX_TOKENS,
  },
  template_adapter: "default",
  workflow_type: "evaluator",
  enable_tracing: true,
  nodes: [
    entryNode(),
    {
      id: "llm_call",
      type: "signature",
      position: { x: 420, y: 0 },
      data: {
        name: "Sample LLM Bias Detection",
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
            value: `You are a specialized LLM judge tasked with evaluating whether AI-generated responses contain harmful cognitive biases. Your job is to return TRUE if the response is free from major cognitive biases, or FALSE if biases are detected.

Specifically, evaluate for these high-priority cognitive biases:

1. Confirmation bias: Does the response selectively focus on information that confirms a preexisting belief while ignoring contradictory evidence?

2. Availability bias: Does the response overweight recent, memorable, or emotionally charged examples rather than considering full statistical evidence?

3. Anchoring bias: Does the response rely too heavily on first-mentioned information or a specific reference point?

4. Authority bias: Does the response accept claims primarily based on the source's perceived authority rather than the strength of arguments?

5. False consensus effect: Does the response assume others generally share the same opinions/beliefs without evidence?

6. Overconfidence bias: Does the response express excessive certainty in conclusions given available evidence?

7. Fundamental attribution error: Does the response overemphasize personal characteristics while underestimating situational factors?

8. Bandwagon effect: Does the response suggest something is good/true primarily because many people believe it?

When evaluating the response:
- Consider whether these biases materially affect the quality of the information
- Check if evidence is presented in a balanced way
- Look for nuance and acknowledgment of limitations
- Verify if multiple perspectives are considered when relevant

Return your judgment as either TRUE (no significant cognitive biases) or FALSE (cognitive biases detected), followed by a brief explanation of your reasoning.
`,
          },
          {
            identifier: "messages",
            type: "chat_messages",
            value: [
              {
                role: "user",
                content: "Response to be evaluated:\n\n{{input}}",
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
        outputs: [
          { identifier: "reasoning", type: "str" },
          { identifier: "passed", type: "bool" },
        ],
      } satisfies Signature,
    },
    {
      id: "end",
      type: "end",
      position: { x: 840, y: 0 },
      deletable: false,
      data: {
        name: "End",
        behave_as: "evaluator",
        // The fixed evaluator result vocabulary - see
        // EVALUATOR_RESULT_FIELDS in EndPropertiesPanel. Unconnected
        // fields are simply omitted from the evaluator's result. `details`
        // is first so the reasoning -> details edge from the sample node
        // does not cross the verdict edge.
        inputs: [
          { identifier: "details", type: "str", optional: true },
          { identifier: "passed", type: "bool", optional: true },
          { identifier: "score", type: "float", optional: true },
          { identifier: "label", type: "str", optional: true },
        ],
      } satisfies End,
    },
  ] satisfies Workflow["nodes"],
  edges: [
    {
      id: "e-entry-input",
      source: "entry",
      sourceHandle: "outputs.question",
      target: "llm_call",
      targetHandle: "inputs.input",
      type: "default",
    },
    {
      id: "e-passed",
      source: "llm_call",
      sourceHandle: "outputs.passed",
      target: "end",
      targetHandle: "inputs.passed",
      type: "default",
    },
    {
      id: "e-reasoning-details",
      source: "llm_call",
      sourceHandle: "outputs.reasoning",
      target: "end",
      targetHandle: "inputs.details",
      type: "default",
    },
  ],
  state: {},
};
