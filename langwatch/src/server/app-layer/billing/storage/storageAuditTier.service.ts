import type { StorageAuditStateRepository } from "./repositories/storage-audit-state.repository";

export type StorageAuditTier = "daily" | "weekly";

/**
 * Rollout posture (ADR-039 Decision 7): the audit runs DAILY for every org
 * through shadow mode and the first full billing cycle. Demoting the
 * default to weekly is an explicit post-cycle decision — flipping this
 * constant — and even then the reasons below keep individual orgs daily.
 */
export const DEFAULT_AUDIT_TIER: StorageAuditTier = "daily";

export interface StorageAuditTierDeps {
  auditState: StorageAuditStateRepository;
  /**
   * True while any `ALTER UPDATE _retention_days` mutation for the org is
   * in flight or wedged — the fold's full-application assumption doesn't
   * hold until it completes (ADR-039 Decision 3).
   */
  hasRetentionMutationInFlight: (params: {
    organizationId: string;
  }) => Promise<boolean>;
}

/**
 * Which audit cadence an org is on. Two overrides pin an org to daily
 * regardless of the default: a past audit alarm (permanent — Decision 7)
 * and an in-flight/wedged retention mutation (until confirmed complete —
 * Decision 3). Reasons are returned so operators can see WHY.
 */
export class StorageAuditTierService {
  constructor(private readonly deps: StorageAuditTierDeps) {}

  async computeTier({
    organizationId,
    defaultTier = DEFAULT_AUDIT_TIER,
  }: {
    organizationId: string;
    defaultTier?: StorageAuditTier;
  }): Promise<{ tier: StorageAuditTier; reasons: string[] }> {
    const reasons: string[] = [];

    const state = await this.deps.auditState.findByOrganization({
      organizationId,
    });
    if (state?.everAlarmedAt) reasons.push("alarmed-permanently-daily");

    if (await this.deps.hasRetentionMutationInFlight({ organizationId })) {
      reasons.push("retention-mutation-in-flight");
    }

    return { tier: reasons.length > 0 ? "daily" : defaultTier, reasons };
  }
}
