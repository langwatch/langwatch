/**
 * Save-time validation for model name mappings, shared by the virtual-key
 * and routing-policy editors.
 *
 * Reject what is ambiguous while it is being configured, accept maximally
 * at runtime. The gateway resolves aliases against a pre-built map and
 * refuses at dispatch when the target names a provider it has no binding
 * for. That is the safety net, but surfacing the mismatch while the
 * operator is still editing keeps the feedback loop short and keeps a
 * misconfigured key out of production.
 *
 * Rule: every mapping whose target carries a `<provider>/...` prefix must
 * reference a provider type actually bound here. Targets without a prefix
 * (`mini` to `gpt-5-mini`) are left to runtime resolution.
 *
 * See /ai-gateway/model-naming.
 */
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
