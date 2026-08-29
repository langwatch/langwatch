/**
 * How a target of a comparison is named.
 *
 * A target is an agent together with its parameter overrides. Its label is the
 * agent name alone, unless the same agent appears more than once in the list:
 * then the overrides tell the two apart, as `name · model=gpt-5`.
 *
 * Framework-free, so the run dialog and the server derive one name from one
 * rule.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

/** The values a parameter override may hold. */
type ParameterValue = string | number | boolean;

/** The overrides of one target, as `k=v, k=v` with the keys sorted. */
export function targetParametersLabel(
  params: Readonly<Record<string, ParameterValue>> | undefined,
): string {
  return Object.keys(params ?? {})
    .sort()
    .map((name) => `${name}=${String(params?.[name])}`)
    .join(", ");
}

/**
 * What one target is called.
 *
 * `duplicated` says the same agent appears elsewhere in the list, which is
 * when the overrides join the name. An agent that appears once is named
 * alone, whatever it was run with.
 */
export function targetLabelOf({
  name,
  runParameters,
  duplicated,
}: {
  name: string;
  runParameters?: Readonly<Record<string, ParameterValue>>;
  duplicated: boolean;
}): string {
  if (!duplicated) return name;
  const parameters = targetParametersLabel(runParameters);
  return parameters === "" ? name : `${name} · ${parameters}`;
}
