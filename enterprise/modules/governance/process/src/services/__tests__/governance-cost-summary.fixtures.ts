// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The summary service over its memory twins; the peers are scripted fixtures that throw on anything else. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi, GatewaySpendDay } from "@langwatch/gateway-contract";
import type { InternalProject, ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type {
  GovernanceSeatReportRow,
  OcsfSeatReportReader,
} from "../../repositories/clickhouse/clickhouse.ocsf-events.repository.ts";
import {
  type MemoryGovernanceCostCell,
  MemoryGovernanceCostRollupRepository,
} from "../../repositories/memory/memory.governance-cost-rollup.repository.ts";
import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";
import { GovernanceCostNoticesService } from "../governance-cost-notices.service.ts";
import { GovernanceCostSummaryService } from "../governance-cost-summary.service.ts";

export const NOW = Temporal.Instant.from("2026-09-25T12:00:00Z");
export const TENANT = "governance-project";

const GOVERNANCE_PROJECT: InternalProject = {
  id: TENANT,
  name: "Governance",
  slug: "governance",
  teamId: "team",
  kind: "internal_governance",
  archivedAtMs: null,
  traceSharingEnabled: false,
};

export function cell(overrides: Partial<MemoryGovernanceCostCell>): MemoryGovernanceCostCell {
  return {
    tenantId: TENANT,
    day: "2026-09-20",
    costSource: "pulled",
    ingestionSourceId: "src_1",
    provider: "openai",
    model: "gpt-5",
    agentId: "",
    currencyCode: "USD",
    rawActorId: "",
    amountNanoUsd: 1_000_000_000,
    amountNanoMinor: 1_000_000_000,
    ...overrides,
  };
}

export function gatewayDay(overrides: Partial<GatewaySpendDay> = {}): GatewaySpendDay {
  return {
    day: "2026-09-20",
    amountNanoUsd: 0,
    requestCount: 0,
    pricedRequestCount: 0,
    requestsWithoutAmount: 0,
    ...overrides,
  };
}

export function seatPool(
  overrides: Partial<GovernanceSeatReportRow> = {},
): GovernanceSeatReportRow {
  return {
    sourceId: "is-1",
    skuPartNumber: "AGENT_SEAT_USL",
    day: "2026-09-20",
    seatsBought: 4,
    seatsAssigned: 2,
    perPerson: true,
    live: true,
    free: false,
    seatStem: true,
    ...overrides,
  };
}

export function setup({
  governed = true,
  gatewayDays = async () => [],
  seats = async () => [],
}: {
  governed?: boolean;
  gatewayDays?: GatewayApi["findSpendDaysForOrganizationProjects"];
  seats?: OcsfSeatReportReader["findLatestSeatReports"];
} = {}) {
  const costRollup = MemoryGovernanceCostRollupRepository.create();
  const sources = MemoryIngestionSourceRepository.create({ now: () => NOW.epochMilliseconds });
  const gatewayAsked: unknown[] = [];
  const projects = createApiFixture<ProjectApi>({
    findInternal: async () => (governed ? GOVERNANCE_PROJECT : null),
    listIdsByOrganization: async () => ["proj-a", "proj-b"],
  });
  const gateway = createApiFixture<GatewayApi>({
    findSpendDaysForOrganizationProjects: async (input) => {
      gatewayAsked.push(input);
      return gatewayDays(input);
    },
  });
  const service = GovernanceCostSummaryService.create({
    costRollup,
    projects,
    gateway,
    seats: { findLatestSeatReports: seats },
    notices: GovernanceCostNoticesService.create({ sources, costRollup }),
  });
  const read = () => service.summary({ organizationId: "org_1", windowDays: 30, now: NOW });
  return { costRollup, sources, service, gatewayAsked, read };
}
