// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `GovernanceCostService` breakdown reads (ADR-128). @see specs/governance/governance-cost-screen.feature */
import type {
  GovernanceCostDayRecords,
  GovernanceCostModelBreakdown,
  GovernanceCostPeriodRecordsInput,
  GovernanceCostProviderDayBreakdown,
  GovernanceCostWindowInput,
  GovernanceSpenderBreakdown,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type { DiscoveredPersonRepository } from "../repositories/discovered-person.repository.ts";
import type { GovernanceCostRollupRepository } from "../repositories/governance-cost-rollup.repository.ts";
import {
  modelRowsFrom,
  periodRecordsFrom,
  spenderFigure,
  spenderRowsFrom,
  trailingCostWindow,
} from "../rules/governance-cost-figures.rules.ts";

type WindowRead = GovernanceCostWindowInput & { now?: Instant };

export class GovernanceCostBreakdownService {
  private constructor(
    private readonly deps: {
      costRollup: GovernanceCostRollupRepository;
      projects: Pick<ProjectApi, "findInternal">;
      discoveredPeople: Pick<DiscoveredPersonRepository, "findByOrganization">;
    },
  ) {}

  static create(deps: {
    costRollup: GovernanceCostRollupRepository;
    projects: Pick<ProjectApi, "findInternal">;
    discoveredPeople: Pick<DiscoveredPersonRepository, "findByOrganization">;
  }): GovernanceCostBreakdownService {
    return new GovernanceCostBreakdownService(deps);
  }

  async dailyByProvider(input: WindowRead): Promise<GovernanceCostProviderDayBreakdown> {
    const { windowDays } = input;
    const tenantId = await this.governanceTenantId(input.organizationId);
    if (!tenantId) return { unavailableReason: "no_governance_project", rows: [], windowDays };
    const groups = await this.deps.costRollup.sumDaysByProvider({
      tenantId,
      ...trailingCostWindow({ now: input.now ?? nowInstant(), windowDays }),
    });
    const rows = groups.map((group) => ({
      day: group.day,
      provider: group.provider,
      ...spenderFigure([group]),
    }));
    return { unavailableReason: null, rows, windowDays };
  }

  async spendByModel(input: WindowRead): Promise<GovernanceCostModelBreakdown> {
    const { windowDays } = input;
    const tenantId = await this.governanceTenantId(input.organizationId);
    if (!tenantId) return { unavailableReason: "no_governance_project", rows: [], windowDays };
    const groups = await this.deps.costRollup.sumWindowByModel({
      tenantId,
      ...trailingCostWindow({ now: input.now ?? nowInstant(), windowDays }),
    });
    return { unavailableReason: null, rows: modelRowsFrom(groups), windowDays };
  }

  async periodRecords(input: GovernanceCostPeriodRecordsInput): Promise<GovernanceCostDayRecords> {
    const tenantId = await this.governanceTenantId(input.organizationId);
    if (!tenantId) return { unavailableReason: "no_governance_project", records: [] };
    const groups = await this.deps.costRollup.sumPeriodRecordsByProvider({
      tenantId,
      fromDay: input.fromDay,
      toDay: input.toDay,
      provider: input.provider,
    });
    return { unavailableReason: null, records: periodRecordsFrom(groups) };
  }

  async spenderBreakdown(input: WindowRead): Promise<GovernanceSpenderBreakdown> {
    const { organizationId, windowDays } = input;
    const tenantId = await this.governanceTenantId(organizationId);
    if (!tenantId) return { unavailableReason: "no_governance_project", rows: [], windowDays };
    const window = trailingCostWindow({ now: input.now ?? nowInstant(), windowDays });
    const [groups, people] = await Promise.all([
      this.deps.costRollup.sumWindowBySpender({ tenantId, ...window }),
      this.deps.discoveredPeople.findByOrganization({ organizationId }),
    ]);
    return { unavailableReason: null, rows: spenderRowsFrom({ groups, people }), windowDays };
  }

  /** Main's `resolveGovProjectId`: the org's unarchived internal_governance project, never provisioned here. */
  private async governanceTenantId(organizationId: string): Promise<string | undefined> {
    const project = await this.deps.projects.findInternal({
      organizationId,
      kind: "internal_governance",
    });
    return project?.id;
  }
}
