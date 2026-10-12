// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RecordCodingAssistantBillingCommand } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import {
  ORGANIZATION_ID_PAGE_LIMIT,
  type OrganizationIdPage,
  type OrganizationIdPageInput,
} from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { CostAttributionPolicyRepository } from "../../../repositories/cost-attribution-policy.repository.ts";
import {
  CODING_ASSISTANT_BILLING_SOURCE_TYPES,
  isSourceBilledByConfigs,
} from "../rules/coding-assistant-billing.rules.ts";

const logger = createLogger("langwatch:governance:coding-assistant-billing");

/** How many organisations the backfill reads and sends for at once. */
const BACKFILL_SLICE = 100;

type FactCollaborators = {
  policies: Pick<
    CostAttributionPolicyRepository,
    "enabledCodingAssistantConfigs" | "findEnabledCodingAssistantConfigs"
  >;
  /** The organisations the backfill sweeps, a page at a time (round 49: never all in memory). */
  organizationIds: (input: OrganizationIdPageInput) => Promise<OrganizationIdPage>;
  record: (command: RecordCodingAssistantBillingCommand) => Promise<unknown>;
  /** The backfill's send: many commands in one queue call. */
  recordMany: (commands: RecordCodingAssistantBillingCommand[]) => Promise<unknown>;
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
    for (const command of factsOf({ organizationId, configs, recordedAtMs: this.now() })) {
      await this.collaborators.record(command);
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

  /** One page's organisations: one config read and one batch send per slice; false on abort. */
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
    for (let start = 0; start < ids.length; start += BACKFILL_SLICE) {
      if (signal?.aborted) return false;
      const slice = ids.slice(start, start + BACKFILL_SLICE);
      if (!dryRun) {
        const rows = await this.collaborators.policies.findEnabledCodingAssistantConfigs({
          organizationIds: slice,
        });
        const configsOf = new Map<string, unknown[]>();
        for (const row of rows) {
          configsOf.set(row.organizationId, [
            ...(configsOf.get(row.organizationId) ?? []),
            row.config,
          ]);
        }
        const recordedAtMs = this.now();
        const commands = slice.flatMap((organizationId) =>
          factsOf({
            organizationId,
            configs: configsOf.get(organizationId) ?? [],
            recordedAtMs,
          }),
        );
        await this.collaborators.recordMany(commands);
        totals.recorded += commands.length;
      }
      totals.organizations += slice.length;
    }
    return true;
  }

  private now(): number {
    return this.collaborators.clock ? this.collaborators.clock() : nowInstant().epochMilliseconds;
  }
}

/** The organisation's billed answer for every assistant kind, one command each. */
function factsOf({
  organizationId,
  configs,
  recordedAtMs,
}: {
  organizationId: string;
  configs: readonly unknown[];
  recordedAtMs: number;
}): RecordCodingAssistantBillingCommand[] {
  return CODING_ASSISTANT_BILLING_SOURCE_TYPES.map((sourceType) => ({
    tenantId: organizationId,
    occurredAt: recordedAtMs,
    data: {
      organizationId,
      sourceType,
      billed: isSourceBilledByConfigs({ configs: [...configs], sourceType }),
      recordedAtMs,
    },
  }));
}
