// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `readStaleSources`, `readUnpricedWindow` and `readAzureBillingNote`, over one source read. @see specs/governance/governance-cost-screen.feature */
import type { GovernanceCostSummary } from "@langwatch/enterprise-governance-contract";

import {
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostRollupRepository,
  type GovernanceCostRollupWindow,
} from "../repositories/governance-cost-rollup.repository.ts";
import type { IngestionSourceRepository } from "../repositories/ingestion-source.repository.ts";
import { azureBillSourceId } from "../rules/azure-bill-identity.rules.ts";
import { readPrepaidDeclared } from "../rules/azure-bill-ownership.rules.ts";
import {
  claimingAzureSources,
  costCaveatsFrom,
  readStoredCostCursor,
} from "../rules/governance-cost-notices.rules.ts";

type Sources = Pick<IngestionSourceRepository, "findAll" | "findUnpricedUsageWindows">;

export class GovernanceCostNoticesService {
  private constructor(
    private readonly deps: {
      sources: Sources;
      costRollup: Pick<GovernanceCostRollupRepository, "hasRowsForSource">;
    },
  ) {}

  static create(deps: {
    sources: Sources;
    costRollup: Pick<GovernanceCostRollupRepository, "hasRowsForSource">;
  }): GovernanceCostNoticesService {
    return new GovernanceCostNoticesService(deps);
  }

  /** One read of the organization's sources answers all three caveats. */
  async caveats({
    organizationId,
    ...window
  }: GovernanceCostRollupWindow & {
    organizationId: string;
  }): Promise<Pick<GovernanceCostSummary, "staleSources" | "unpricedWindow" | "azureBilling">> {
    const [sources, unpricedWindows] = await Promise.all([
      this.deps.sources.findAll(organizationId),
      this.deps.sources.findUnpricedUsageWindows(organizationId),
    ]);
    const [claiming] = claimingAzureSources(sources);
    const cursor = readStoredCostCursor(claiming?.pollerCursor);
    const azureBill = claiming && {
      isPrepaidDeclared: readPrepaidDeclared(claiming.parserConfig),
      hasAzureSpendRows: await this.deps.costRollup.hasRowsForSource({
        ...window,
        costSource: GOVERNANCE_COST_SOURCE.PULLED,
        ingestionSourceId: azureBillSourceId(claiming),
      }),
      ...cursor,
    };
    return costCaveatsFrom({ sources, unpricedWindows, azureBill });
  }
}
