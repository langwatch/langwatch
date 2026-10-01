/** Rejects model alias mappings targeting unbound providers while editing. */
export function validateModelAliasesAgainstBoundProviders({
  aliases,
  boundProviderTypes,
}: {
  aliases: Record<string, string>;
  boundProviderTypes: ReadonlySet<string>;
}): { errors: string[] } {
  const errors: string[] = [];
  for (const [from, to] of Object.entries(aliases)) {
    if (!to.includes("/")) continue;
    const providerPrefix = to.split("/", 1)[0];
    if (providerPrefix && !boundProviderTypes.has(providerPrefix)) {
      errors.push(
        `Alias "${from}" → "${to}" references provider "${providerPrefix}", which is not one of the providers configured here (${[...boundProviderTypes].join(", ") || "none"}).`,
      );
    }
  }
  return { errors };
}
