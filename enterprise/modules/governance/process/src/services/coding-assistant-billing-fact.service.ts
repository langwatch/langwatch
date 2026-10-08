// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RecordCodingAssistantBillingCommand } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import {
  ORGANIZATION_ID_PAGE_LIMIT,
  type OrganizationIdPage,
  type OrganizationIdPageInput,
} from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { CostAttributionPolicyRepository } from "../repositories/cost-attribution-policy.repository.ts";
import {
  CODING_ASSISTANT_BILLING_SOURCE_TYPES,
  isSourceBilledByConfigs,
} from "../rules/coding-assistant-billing.rules.ts";

const logger = createLogger("langwatch:governance:coding-assistant-billing");

type FactCollaborators = {
  policies: Pick<CostAttributionPolicyRepository, "enabledCodingAssistantConfigs">;
  /** The organisations the backfill sweeps, a page at a time (round 49: never all in memory). */
  organizationIds: (input: OrganizationIdPageInput) => Promise<OrganizationIdPage>;
  record: (command: RecordCodingAssistantBillingCommand) => Promise<unknown>;
  clock?: () => number;
};

/** Q82 (Alex, 2026-10-06): the billed fact per (organization, source) that trace folds at ingest. */
export class CodingAssistantBillingFactService {
  private constructor(private readonly collaborators: FactCollaborators) {}

  static create(collaborators: FactCollaborators): CodingAssistantBillingFactService {
    return new CodingAssistantBillingFactService(collaborators);
  }

  /** One fact per assistant kind, read after the write so it states the organization's whole answer. */
  async recordForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ recorded: number }> {
    const configs = await this.collaborators.policies.enabledCodingAssistantConfigs(organizationId);
    const recordedAtMs = this.now();
    for (const sourceType of CODING_ASSISTANT_BILLING_SOURCE_TYPES) {
      await this.collaborators.record({
        tenantId: organizationId,
        occurredAt: recordedAtMs,
        data: {
          organizationId,
          sourceType,
          billed: isSourceBilledByConfigs({ configs, sourceType }),
          recordedAtMs,
        },
      });
    }
    return { recorded: CODING_ASSISTANT_BILLING_SOURCE_TYPES.length };
  }

  /** After an admin edit: a lost fact leaves trace's last answer standing, so it is logged, not refused. */
  async recordAfterChange({ organizationId }: { organizationId: string }): Promise<void> {
    try {
      await this.recordForOrganization({ organizationId });
    } catch (error) {
      logger.warn({ error, organizationId }, "coding-assistant billing fact not recorded");
    }
  }

  /**
   * The backfill: each organisation after `after` records its facts, a page at a time; `onPage`
   * hears the last organisation of each completed page. Stops between organisations on abort.
   */
  async backfill({
    after,
    dryRun = false,
    signal,
    onPage,
  }: {
    after?: string | undefined;
    dryRun?: boolean;
    signal?: AbortSignal;
    onPage?: (page: { afterOrganizationId: string }) => Promise<void>;
  } = {}): Promise<{
    afterOrganizationId: string | null;
    organizations: number;
    recorded: number;
  }> {
    const totals = { organizations: 0, recorded: 0 };
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal?.aborted) {
      const page = await this.collaborators.organizationIds({
        ...(cursor === undefined ? {} : { after: cursor }),
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const completed = await this.recordPage({ ids: page.ids, dryRun, signal, totals });
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        await onPage?.({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, ...totals };
  }

  /** One page's organisations; false when the signal stopped it part way. */
  private async recordPage({
    ids,
    dryRun,
    signal,
    totals,
  }: {
    ids: readonly string[];
    dryRun: boolean;
    signal: AbortSignal | undefined;
    totals: { organizations: number; recorded: number };
  }): Promise<boolean> {
    for (const organizationId of ids) {
      if (signal?.aborted) return false;
      if (!dryRun)
        totals.recorded += (await this.recordForOrganization({ organizationId })).recorded;
      totals.organizations += 1;
    }
    return true;
  }

  private now(): number {
    return this.collaborators.clock ? this.collaborators.clock() : nowInstant().epochMilliseconds;
  }
}
