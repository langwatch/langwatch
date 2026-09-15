/**
 * The display fallback every budget surface wants: the resolved provider
 * label, else the raw key, else null when the budget filters on no provider.
 * Pure, so it lives here rather than beside the Postgres lookup that fills
 * the map — a transport must not reach into `repositories/prisma` for it.
 */
export class GatewayProviderLabelAdapter {
  static create(): GatewayProviderLabelAdapter {
    return new GatewayProviderLabelAdapter();
  }

  private constructor() {}

  labelFor(labels: Map<string, string>, providerKey: string | null): string | null {
    return providerKey ? (labels.get(providerKey) ?? providerKey) : null;
  }
}
