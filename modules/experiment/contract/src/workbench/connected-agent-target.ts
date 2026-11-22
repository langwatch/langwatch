// Connected agent: runs in customer's process, answers one turn at a time
// (ADR-128). A workbench row is one turn; each column maps its own parameter
// values (dataset or fixed), the rest keep function defaults.

import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import type { Field } from "@langwatch/workflow-contract";

/** The input field a connected agent column reads the turn from. */
export const CONNECTED_INPUT_FIELD = "input";

/**
 * The input field a connected agent column reads an attachment from: optional and
 * typed as a file, so it reaches the agent as a content part beside the turn.
 */
export const CONNECTED_ATTACHMENT_FIELD = "attachment";

/** The output field a connected agent column writes the answer to. */
export const CONNECTED_OUTPUT_FIELD = "output";

/**
 * The parameters the agent declared, as a column reads them. Secrets are left
 * out of the stored mapping (read by everyone who opens it); a run needing
 * one is a simulation, where secrets are supplied per run and encrypted.
 */
export const connectedParameterDefinitions = (source: unknown): ScenarioParameterDefinition[] => {
  const declared = (source as { parameters?: ScenarioParameterDefinition[] } | undefined)
    ?.parameters;
  if (!Array.isArray(declared)) return [];
  return declared.filter((definition) => !definition.secret);
};

/** The field type a declared parameter is edited and mapped as. */
const fieldTypeOf = (definition: ScenarioParameterDefinition): Field["type"] => {
  switch (definition.type) {
    case "number":
      return "float";
    case "boolean":
      return "bool";
    default:
      return "str";
  }
};

/**
 * The inputs and outputs of a connected agent column. Every parameter is
 * optional: an unmapped one runs on the function's own default. A required
 * parameter left unmapped is refused by the SDK, by name, not silently.
 */
export const connectedTargetFields = (source: unknown): { inputs: Field[]; outputs: Field[] } => ({
  inputs: [
    { identifier: CONNECTED_INPUT_FIELD, type: "str" },
    { identifier: CONNECTED_ATTACHMENT_FIELD, type: "file", optional: true },
    ...connectedParameterDefinitions(source).map((definition): Field => ({
      identifier: definition.name,
      type: fieldTypeOf(definition),
      optional: true,
      ...(definition.description ? { desc: definition.description } : {}),
    })),
  ],
  outputs: [{ identifier: CONNECTED_OUTPUT_FIELD, type: "str" }],
});
