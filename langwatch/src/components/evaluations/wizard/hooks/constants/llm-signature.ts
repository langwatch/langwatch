import { MODULES } from "~/optimization_studio/registry";

const DEFAULT_LLM_CONFIG = {
  model: "openai/gpt-4o-mini",
};

export const DEFAULT_SIGNATURE_NODE_PROPERTIES = {
  id: "signature-node",
  position: { x: 0, y: 0 },
  deletable: true,
  data: {
    // Default signature data
    ...MODULES.signature,
    parameters: [
      ...(MODULES.signature.parameters ?? []).map((p) =>
        // Set the default LLM config
        p.identifier === "llm"
          ? {
              ...p,
              value: DEFAULT_LLM_CONFIG,
            }
          : p
      ),
    ],
    inputs: [
      {
        identifier: "input",
        type: "str" as const,
      },
    ],
    outputs: [
      {
        identifier: "output",
        type: "str" as const,
      },
    ],
  },
  type: "signature",
};
