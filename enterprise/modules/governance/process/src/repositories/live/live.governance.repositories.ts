// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ProcessMembers } from "@langwatch/process-stores/members";

import { memberClickHouseResolver } from "../clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse/clickhouse.ocsf-events.repository.ts";
import { ClickHouseRollupErasureRepository } from "../clickhouse/clickhouse.rollup-erasure.repository.ts";
import { ClickHouseTraceActivityRepository } from "../clickhouse/clickhouse.trace-activity.repository.ts";
import type { GovernanceRepositories } from "../governance.repositories.ts";
import { PostgresGovernanceRepositories } from "../prisma/prisma.governance.repositories.ts";

/** Governance's live stores: its rows in Prisma; in ClickHouse, pulled OCSF events and the rollups an erasure rewrites. */
export class LiveGovernanceRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create({
    prisma,
    clickhouse,
  }: Pick<ProcessMembers, "prisma" | "clickhouse">): GovernanceRepositories {
    return {
      ...PostgresGovernanceRepositories.create({ prisma }),
      ocsfEvents: ClickHouseOcsfEventsRepository.create(memberClickHouseResolver(clickhouse)),
      rollupErasure: ClickHouseRollupErasureRepository.create(clickhouse),
      traceActivity: ClickHouseTraceActivityRepository.create(memberClickHouseResolver(clickhouse)),
    };
  }
}
