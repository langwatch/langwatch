// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ProcessMembers } from "@langwatch/process-stores/members";

import {
  memberClickHouseResolver,
  memberGovernanceClickHouseResolver,
} from "../clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../clickhouse/clickhouse.governance-cost-rollup.repository.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse/clickhouse.ocsf-events.repository.ts";
import { ClickHouseRollupErasureRepository } from "../clickhouse/clickhouse.rollup-erasure.repository.ts";
import { ClickHouseTraceActivityRepository } from "../clickhouse/clickhouse.trace-activity.repository.ts";
import type { GovernanceRepositories } from "../governance.repositories.ts";
import { PostgresGovernanceRepositories } from "../prisma/prisma.governance.repositories.ts";
import { PrismaActivityMonitorRepository } from "../prisma/prisma.ingestion-source-activity.repository.ts";

/** Governance's live stores: its rows in Prisma; in ClickHouse, pulled OCSF events and the rollups an erasure rewrites. */
export class LiveGovernanceRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create({
    prisma,
    clickhouse,
  }: Pick<ProcessMembers, "prisma" | "clickhouse">): GovernanceRepositories {
    return {
      ...PostgresGovernanceRepositories.create({ prisma }),
      activityMonitor: PrismaActivityMonitorRepository.create({
        prisma,
        clickhouse: memberGovernanceClickHouseResolver(clickhouse),
      }),
      costRollup: ClickHouseGovernanceCostRollupRepository.create(
        memberClickHouseResolver(clickhouse),
      ),
      ocsfEvents: ClickHouseOcsfEventsRepository.create(memberClickHouseResolver(clickhouse)),
      rollupErasure: ClickHouseRollupErasureRepository.create(clickhouse),
      traceActivity: ClickHouseTraceActivityRepository.create(memberClickHouseResolver(clickhouse)),
    };
  }
}
