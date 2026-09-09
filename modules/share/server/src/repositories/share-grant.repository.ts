import type { ShareResourceType } from "@langwatch/share-contract";

export interface ShareGrantScope {
  organizationId: string;
  projectId: string;
  id?: string;
  resourceKind?: ShareResourceType;
  resourceId?: string;
}

export interface ConsumeShareUsageParams {
  grantId: string;
  organizationId: string;
  projectId: string;
  maxViews: number | null;
}

/**
 * The grants-ledger half of a share link: the resource grants that name its
 * links, and the GrantUsage row that owns a cut-over link's view count
 * (ADR-092, decision 22).
 */
export interface ShareGrantRepository {
  /** Project-scoped resource grants matching every supplied discriminator. */
  findAllResourceGrantIds(scope: ShareGrantScope): Promise<string[]>;

  /**
   * Consume one view on GrantUsage and mirror it onto the compatible
   * ShareLink row in the same transaction. False when the cap refuses it.
   */
  consumeUsage(params: ConsumeShareUsageParams): Promise<boolean>;
}
