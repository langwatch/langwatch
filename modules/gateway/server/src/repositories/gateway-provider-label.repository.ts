/**
 * Display names for ModelProvider rows referenced by provider-filtered budgets, so a filter renders as "OpenAI only" instead of a row id. Shared by the budgets list and applicable-budgets resolver so one provider never renders under two names.
 */
export abstract class GatewayProviderLabelRepository {
  abstract resolveProviderLabels(
    budgets: Array<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
}
