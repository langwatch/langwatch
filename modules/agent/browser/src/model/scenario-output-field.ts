/**
 * The stored scenario output field carries three states in one optional string, as the previous
 * release stored it: `undefined` is "not chosen, use the first output", `""` is "cleared on
 * purpose", and any other string is the choice.
 */

/** The output used when the agent declares none. */
const DEFAULT_OUTPUT_IDENTIFIER = "output";

/** The output the editor shows as the scenario result, or null when the user cleared it. */
export function selectedScenarioOutput({
  outputField,
  outputs,
}: {
  outputField: string | undefined;
  outputs: readonly { identifier: string }[];
}): string | null {
  if (outputField === "") return null;
  if (outputField !== undefined) return outputField;
  return outputs[0]?.identifier ?? DEFAULT_OUTPUT_IDENTIFIER;
}

/** What a pick in the editor stores: the chosen output, or `""` when the pick was cleared. */
export function storedScenarioOutput(selected: string | undefined): string {
  return selected ?? "";
}
