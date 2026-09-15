/**
 * The display fallback every budget surface wants: the resolved provider
 * label, else the raw key, else null when the budget filters on no provider.
 *
 * Pure, and so it lives here rather than beside the Postgres lookup that
 * fills the map. A transport reaching into `repositories/prisma` for it was
 * how a door came to import a persistence module for a string choice that
 * touches no database at all.
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
