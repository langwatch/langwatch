/**
 * What a connected agent reads as a workbench column.
 *
 * A connected agent runs in the customer's own process and answers one turn
 * at a time (ADR-128). A workbench row is one such turn, so the column reads
 * a single input, the message to send, and writes a single output, the answer.
 *
 * The parameters the function declares become optional inputs beside it. That
 * is what makes "the same agent on two models" two columns rather than two
 * agents: each column maps its own value, from the dataset or as a fixed
 * value, and the rest keep whatever default the function declares.
 *
 * @see specs/experiments-v3/connected-agent-target.feature
 */

import type { Field } from "~/optimization_studio/types/dsl";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";

/** The input field a connected agent column reads the turn from. */
export const CONNECTED_INPUT_FIELD = "input";

/** The output field a connected agent column writes the answer to. */
export const CONNECTED_OUTPUT_FIELD = "output";

/**
 * The parameters the agent declared, as a column reads them.
 *
 * Secrets are left out: a column mapping is stored in the experiment and read
 * back by everyone who opens it, which is not where a credential goes. A run
 * that needs one is a simulation, where secret values are supplied per run
 * and encrypted.
 */
export const connectedParameterDefinitions = (
  source: unknown,
): ScenarioParameterDefinition[] => {
  const declared = (
    source as { parameters?: ScenarioParameterDefinition[] } | undefined
  )?.parameters;
  if (!Array.isArray(declared)) return [];
  return declared.filter((definition) => !definition.secret);
};

/** The field type a declared parameter is edited and mapped as. */
const fieldTypeOf = (
  definition: ScenarioParameterDefinition,
): Field["type"] => {
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
 * The inputs and outputs of a connected agent column.
 *
 * Every parameter is optional, whatever the function declares: a column that
 * maps none of them still runs, and the function applies its own defaults. A
 * parameter the function requires is refused by the SDK with the name in the
 * message, which is a clearer answer than a mapping the workbench invented.
 */
export const connectedTargetFields = (
  source: unknown,
): { inputs: Field[]; outputs: Field[] } => ({
  inputs: [
    { identifier: CONNECTED_INPUT_FIELD, type: "str" },
    ...connectedParameterDefinitions(source).map(
      (definition): Field => ({
        identifier: definition.name,
        type: fieldTypeOf(definition),
        optional: true,
        ...(definition.description ? { desc: definition.description } : {}),
      }),
    ),
  ],
  outputs: [{ identifier: CONNECTED_OUTPUT_FIELD, type: "str" }],
});
