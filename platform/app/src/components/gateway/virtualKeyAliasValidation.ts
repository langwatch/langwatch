/**
 * Save-time validation for model aliases on a Virtual Key.
 *
 * Per rchaves's "reject ambiguous at config time, accept maximally at
 * runtime" constraint (iter 107): the gateway hot path resolves aliases
 * against a pre-built map and surfaces errProviderNotBound at runtime if
 * the target slug doesn't exist. That's the safety net — but surfacing
 * the mismatch while the operator is still editing keeps the feedback
 * loop short and prevents misconfigured VKs from leaking into production.
 *
 * Rule: every alias whose target carries a `<provider>/...` prefix must
 * reference a provider type actually bound on this VK. Aliases without a
 * prefix (e.g. `mini` → `gpt-5-mini`) are left to runtime resolution.
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
        `Alias "${from}" → "${to}" references provider "${providerPrefix}", which is not bound on this VK (bound: ${[...boundProviderTypes].join(", ") || "none"}).`,
      );
    }
  }
  return { errors };
}
