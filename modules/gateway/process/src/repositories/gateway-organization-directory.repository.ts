/** One group a per-member budget can target, with how many members it covers. */
export type GatewayGroupTarget = { id: string; name: string; memberCount: number };

/** The organization's groups as a per-member GROUP budget reads them. */
export abstract class GatewayOrganizationDirectoryRepository {
  /** The groups a per-member budget can target, with their sizes, by name. */
  abstract findGroupTargets(organizationId: string): Promise<readonly GatewayGroupTarget[]>;

  /** How many members each GROUP budget's group currently covers; unknown groups are absent. */
  abstract groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>>;
}
