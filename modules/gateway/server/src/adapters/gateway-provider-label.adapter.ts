/**
 * The display fallback every budget surface wants: resolved provider label,
 * else raw key, else null with no provider filter. Pure, so it lives here —
 * a transport must not reach into `repositories/prisma` for it.
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
