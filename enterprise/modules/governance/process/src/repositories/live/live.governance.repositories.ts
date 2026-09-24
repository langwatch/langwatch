// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ProcessMembers } from "@langwatch/process-stores/members";

import { ClickHouseRollupErasureRepository } from "../clickhouse/clickhouse.rollup-erasure.repository.ts";
import type { GovernanceRepositories } from "../governance.repositories.ts";
import { PostgresGovernanceRepositories } from "../prisma/prisma.governance.repositories.ts";

/** Governance's live stores: its rows in Prisma, and the cost rollups an erasure rewrites in ClickHouse. */
export class LiveGovernanceRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create({
    prisma,
    clickhouse,
  }: Pick<ProcessMembers, "prisma" | "clickhouse">): GovernanceRepositories {
    return {
      ...PostgresGovernanceRepositories.create({ prisma }),
      rollupErasure: ClickHouseRollupErasureRepository.create(clickhouse),
    };
  }
}
