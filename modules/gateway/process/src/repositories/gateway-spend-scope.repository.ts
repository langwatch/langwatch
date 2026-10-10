/** The gateway-owned key ids behind the external ids a spend filter names. */
export abstract class GatewaySpendScopeRepository {
  abstract findVirtualKeyIdsForExternalIds(input: {
    organizationId: string;
    externalIds: string[];
  }): Promise<string[]>;
}
