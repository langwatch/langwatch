// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `GovernanceCostService.summary`: three lanes side by side, never summed. @see specs/governance/governance-cost-screen.feature */
import type {
  GovernanceCostSummary,
  GovernanceCostWindowInput,
  GovernanceSeatLane,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import {
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostRollupRepository,
} from "../repositories/governance-cost-rollup.repository.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { spenderFigure, trailingCostWindow } from "../rules/governance-cost-figures.rules.ts";
import {
  currencyTotalsFrom,
  gatewayLaneFrom,
  laneWithoutFigure,
  seatsFrom,
  seriesFrom,
} from "../rules/governance-cost-summary.rules.ts";
import { SEAT_REPORT_ACTION } from "../rules/microsoft-graph-seats.rules.ts";
import type { GovernanceCostNoticesService } from "./governance-cost-notices.service.ts";

type Deps = {
  costRollup: Pick<
    GovernanceCostRollupRepository,
    "sumDaysByLane" | "sumWindowByProvider" | "sumWindowByCurrency"
  >;
  projects: Pick<ProjectApi, "findInternal" | "listIdsByOrganization">;
  gateway: Pick<GatewayApi, "findSpendDaysForOrganizationProjects">;
  seats: Pick<GovernanceRepositories["ocsfEvents"], "findLatestSeatReports">;
  notices: Pick<GovernanceCostNoticesService, "caveats">;
  logger: Logger;
};

export class GovernanceCostSummaryService {
  private constructor(private readonly deps: Deps) {}

  static create({
    logger = createLogger("langwatch:governance:cost"),
    ...deps
  }: Omit<Deps, "logger"> & { logger?: Logger }): GovernanceCostSummaryService {
    return new GovernanceCostSummaryService({ ...deps, logger });
  }

  /** A failed cost read fails the whole summary; only the seat lane degrades on its own. */
  async summary({
    organizationId,
    windowDays,
    now = nowInstant(),
  }: GovernanceCostWindowInput & { now?: Instant }): Promise<GovernanceCostSummary> {
    const { costRollup, projects, gateway, notices } = this.deps;
    const project = await projects.findInternal({ organizationId, kind: "internal_governance" });
    if (!project) return unavailable({ windowDays });
    const tenantId = project.id;
    const gatewayTenantIds = await projects.listIdsByOrganization({ organizationId });
    const window = { tenantId, ...trailingCostWindow({ now, windowDays }) };
    const { fromDay, toDay } = window;

    const [rows, gatewayDays, seats, caveats, providers, billedCurrencies] = await Promise.all([
      costRollup.sumDaysByLane({ ...window, costSource: GOVERNANCE_COST_SOURCE.PULLED }),
      gateway.findSpendDaysForOrganizationProjects({ tenantIds: gatewayTenantIds, fromDay, toDay }),
      this.readSeats(tenantId),
      notices.caveats({ organizationId, ...window }),
      costRollup.sumWindowByProvider(window),
      costRollup.sumWindowByCurrency({ ...window, costSource: GOVERNANCE_COST_SOURCE.PULLED }),
    ]);

    return {
      unavailableReason: null,
      billed: { ...spenderFigure(providers), currencyTotals: currencyTotalsFrom(billedCurrencies) },
      providers: providers.map((row) => ({ provider: row.provider, ...spenderFigure([row]) })),
      gateway: gatewayLaneFrom(gatewayDays),
      azureBilling: caveats.azureBilling,
      seats,
      series: seriesFrom({ rows, gatewayDays, now }),
      windowDays,
      staleSources: caveats.staleSources,
      unpricedWindow: caveats.unpricedWindow,
    };
  }

  private async readSeats(tenantId: string): Promise<GovernanceSeatLane> {
    try {
      return seatsFrom(
        await this.deps.seats.findLatestSeatReports({ tenantId, actionName: SEAT_REPORT_ACTION }),
      );
    } catch (error) {
      this.deps.logger.error(
        { error, tenantId },
        "Governance seat read failed; the seat lane reports the failure while the cost lanes render",
      );
      return { status: "read_failed" };
    }
  }
}

function unavailable({ windowDays }: { windowDays: number }): GovernanceCostSummary {
  return {
    unavailableReason: "no_governance_project",
    billed: laneWithoutFigure(),
    providers: [],
    gateway: laneWithoutFigure(),
    azureBilling: null,
    seats: { status: "awaiting_data" },
    series: [],
    windowDays,
    staleSources: null,
    unpricedWindow: null,
  };
}
