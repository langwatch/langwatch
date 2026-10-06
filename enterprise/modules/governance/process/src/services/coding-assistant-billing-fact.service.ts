// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RecordCodingAssistantBillingCommand } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { CostAttributionPolicyRepository } from "../repositories/cost-attribution-policy.repository.ts";
import {
  CODING_ASSISTANT_BILLING_SOURCE_TYPES,
  isSourceBilledByConfigs,
} from "../rules/coding-assistant-billing.rules.ts";

const logger = createLogger("langwatch:governance:coding-assistant-billing");

type FactCollaborators = {
  policies: Pick<
    CostAttributionPolicyRepository,
    "enabledCodingAssistantConfigs" | "organizationsWithEnabledCodingAssistants"
  >;
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

  /** The backfill: every organization holding an enabled coding-assistant config records its facts. */
  async backfill({ signal }: { signal?: AbortSignal } = {}): Promise<{
    organizations: number;
    recorded: number;
  }> {
    const organizationIds =
      await this.collaborators.policies.organizationsWithEnabledCodingAssistants();
    let recorded = 0;
    for (const organizationId of organizationIds) {
      signal?.throwIfAborted();
      recorded += (await this.recordForOrganization({ organizationId })).recorded;
    }
    return { organizations: organizationIds.length, recorded };
  }

  private now(): number {
    return this.collaborators.clock ? this.collaborators.clock() : nowInstant().epochMilliseconds;
  }
}
