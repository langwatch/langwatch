import type { GatewayBudgetResolutionTarget } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { GatewaySpendWindow } from "../../../repositories/gateway-spend-events.repository.ts";
import type { GatewayVirtualKeyRepository } from "../../../repositories/gateway-virtual-key.repository.ts";
import {
  keysAtOrOverThreshold,
  UNBUDGETED_SPEND_KEY_PURPOSE,
  type UnbudgetedSpendCandidate,
  type UnbudgetedSpendKey,
  type UnbudgetedSpendTotal,
  unbudgetedSpendFactOf,
  type UnbudgetedSpendWindow,
  unbudgetedSpendWindowAt,
} from "../../../rules/gateway-unbudgeted-spend.rules.ts";
import type { GatewayGovernanceEventsService } from "../../../services/gateway-governance-events.service.ts";
import type { GatewayService } from "../../../services/gateway.service.ts";

const logger = createLogger("langwatch:gateway:unbudgeted-spend");

type UnbudgetedSpendCollaborators = Readonly<{
  /** The fleet read of live keys used inside the window: the organizations worth a look. */
  keys: Pick<GatewayVirtualKeyRepository, "findLiveUsedSince">;
  /** The organization's spend tenants, and the resolver enforcement itself calls. */
  budgets: Readonly<{
    listSpendTenantIds: GatewayService["listSpendTenantIds"];
    resolveApplicableBudgets(target: GatewayBudgetResolutionTarget): Promise<readonly unknown[]>;
  }>;
  /** The metered ledger's per-key window totals; only the key and its cost are read. */
  spend: Readonly<{
    sumWindowByVirtualKey(window: GatewaySpendWindow): Promise<readonly UnbudgetedSpendTotal[]>;
  }>;
  /** A key's stored trace destination decides whether team and project budgets reach it. */
  projects: Pick<ProjectApi, "findTraceDestination">;
  facts: Pick<GatewayGovernanceEventsService, "recordUnbudgetedSpend">;
  clock?: () => Instant;
}>;

/** What one sweep did, for its log line and its tests. */
export type UnbudgetedSpendSweepReport = Readonly<{
  organizations: number;
  recorded: number;
  failed: number;
}>;

/**
 * Per organization, the live USER keys at or over the threshold this week that no budget applies
 * to, recorded as one fact. Not the debit ledger: it writes rows only for budgets that apply.
 * Spec: modules/gateway/specs/gateway-governance-events.feature
 */
export class GatewayUnbudgetedSpendService {
  private constructor(private readonly collaborators: UnbudgetedSpendCollaborators) {}

  static create(collaborators: UnbudgetedSpendCollaborators): GatewayUnbudgetedSpendService {
    return new GatewayUnbudgetedSpendService(collaborators);
  }

  /** One organization's failure is logged and skipped; the next sweep tries it again. */
  async sweep(): Promise<UnbudgetedSpendSweepReport> {
    const now = (this.collaborators.clock ?? nowInstant)();
    const window = unbudgetedSpendWindowAt(now);
    const used = await this.collaborators.keys.findLiveUsedSince({
      purpose: UNBUDGETED_SPEND_KEY_PURPOSE,
      since: window.since,
    });
    const byOrganization = new Map<string, UnbudgetedSpendKey[]>();
    for (const key of used) {
      byOrganization.set(key.organizationId, [
        ...(byOrganization.get(key.organizationId) ?? []),
        key,
      ]);
    }

    let recorded = 0;
    let failed = 0;
    for (const [organizationId, keys] of byOrganization) {
      try {
        if (await this.sweepOrganization({ organizationId, keys, window, now })) recorded++;
      } catch (error) {
        failed++;
        logger.warn(
          { organizationId, error },
          "unbudgeted-spend sweep failed for one organization; the next sweep retries it",
        );
      }
    }
    const report = { organizations: byOrganization.size, recorded, failed };
    logger.info(report, "unbudgeted-spend sweep finished");
    return report;
  }

  private async sweepOrganization({
    organizationId,
    keys,
    window,
    now,
  }: Readonly<{
    organizationId: string;
    keys: readonly UnbudgetedSpendKey[];
    window: UnbudgetedSpendWindow;
    now: Instant;
  }>): Promise<boolean> {
    const tenantIds = await this.collaborators.budgets.listSpendTenantIds(organizationId);
    const totals = await this.collaborators.spend.sumWindowByVirtualKey({
      tenantIds,
      fromDay: window.fromDay,
      toDay: window.toDay,
    });
    const unbudgeted: UnbudgetedSpendCandidate[] = [];
    for (const candidate of keysAtOrOverThreshold({ totals, keys })) {
      if (!(await this.isBudgeted(candidate.key))) unbudgeted.push(candidate);
    }
    const [first, ...rest] = unbudgeted;
    if (!first) return false;
    await this.collaborators.facts.recordUnbudgetedSpend(
      unbudgetedSpendFactOf({ organizationId, unbudgeted: [first, ...rest], now }),
    );
    return true;
  }

  /**
   * Whether any budget applies to the key, resolved for the target its config bundle is built
   * from, so "unbudgeted" means exactly what enforcement would not cap.
   */
  private async isBudgeted(key: UnbudgetedSpendKey): Promise<boolean> {
    const traceProject = key.traceProjectId
      ? await this.collaborators.projects.findTraceDestination(key.traceProjectId)
      : null;
    const target: GatewayBudgetResolutionTarget = {
      organizationId: key.organizationId,
      virtualKeyId: key.id,
      teamId: traceProject?.teamId ?? null,
      projectId: traceProject?.id ?? null,
      principalUserId: key.principalUserId,
    };
    const budgets = await this.collaborators.budgets.resolveApplicableBudgets(target);
    return budgets.length > 0;
  }
}
