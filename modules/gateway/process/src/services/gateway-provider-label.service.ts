/**
 * The display fallback every budget surface wants: resolved provider label,
 * else raw key, else null with no provider filter. Pure, so it lives here —
 * a transport must not reach into `repositories/prisma` for it.
 */
export class GatewayProviderLabelService {
  static create(): GatewayProviderLabelService {
    return new GatewayProviderLabelService();
  }

  private constructor() {}

  formatProviderLabel(labels: Map<string, string>, providerKey: string | null): string | null {
    return providerKey ? (labels.get(providerKey) ?? providerKey) : null;
  }
}
