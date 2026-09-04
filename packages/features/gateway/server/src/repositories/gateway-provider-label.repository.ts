/**
 * Display names for the ModelProvider rows referenced by provider-filtered
 * budgets, so a filter renders as "OpenAI only" instead of a row id.
 * Shared by the budgets list and the applicable-budgets resolver so the same
 * provider never renders under two different names.
 */
export abstract class GatewayProviderLabelRepository {
  abstract resolveProviderLabels(
    budgets: Array<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
}
