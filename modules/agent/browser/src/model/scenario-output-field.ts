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

/**
 * Outputs after an edit, with each output the edit added named `output`, `output_1` and so on. The
 * shared fields editor names a new row after inputs, which reads wrong in an outputs list.
 */
export function outputsNamedAsOutputs<T extends { identifier: string }>({
  previous,
  next,
}: {
  previous: readonly T[];
  next: readonly T[];
}): T[] {
  // A rename keeps the count; only an added row is renamed, so a chosen name always stands.
  if (next.length <= previous.length) return [...next];
  const before = new Set(previous.map(({ identifier }) => identifier));
  const taken = new Set(next.map(({ identifier }) => identifier));
  return next.map((field) => {
    if (before.has(field.identifier) || !/^input(_\d+)?$/.test(field.identifier)) return field;
    taken.delete(field.identifier);
    const identifier = uniqueOutputIdentifier(taken);
    taken.add(identifier);
    return { ...field, identifier };
  });
}

function uniqueOutputIdentifier(taken: ReadonlySet<string>): string {
  if (!taken.has(DEFAULT_OUTPUT_IDENTIFIER)) return DEFAULT_OUTPUT_IDENTIFIER;
  let suffix = 1;
  while (taken.has(`${DEFAULT_OUTPUT_IDENTIFIER}_${suffix}`)) suffix += 1;
  return `${DEFAULT_OUTPUT_IDENTIFIER}_${suffix}`;
}
