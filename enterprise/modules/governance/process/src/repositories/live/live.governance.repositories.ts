// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Encryption, RateLimiter } from "@langwatch/process-stores";

import { ClickHouseAnomalySpendRepository } from "../clickhouse/clickhouse.anomaly-spend.repository.ts";
import {
  memberClickHouseResolver,
  memberGovernanceClickHouseResolver,
} from "../clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import { ClickHouseGovernanceCostChargeRepository } from "../clickhouse/clickhouse.governance-cost-charge.repository.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../clickhouse/clickhouse.governance-cost-rollup.repository.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse/clickhouse.ocsf-events.repository.ts";
import { ClickHouseRollupErasureRepository } from "../clickhouse/clickhouse.rollup-erasure.repository.ts";
import type { GovernanceRepositories } from "../governance.repositories.ts";
import { PostgresGovernanceRepositories } from "../prisma/prisma.governance.repositories.ts";
import { PrismaActivityMonitorRepository } from "../prisma/prisma.ingestion-source-activity.repository.ts";
import {
  type GovernanceOperatorReadsMember,
  PrismaSuppressionSnapshotRepository,
} from "../prisma/prisma.suppression-snapshot.repository.ts";
import { RedisGovernanceRateLimitRepository } from "../redis/redis.governance-rate-limit.repository.ts";

/** Governance's live stores: its rows in Prisma; in ClickHouse, OCSF events, KPI rows and the rollups an erasure rewrites. */
export class LiveGovernanceRepositories {
  static readonly requires = [
    "prisma",
    "clickhouse",
    "operatorReads",
    "encryption",
    "rateLimiter",
  ] as const;

  static create({
    prisma,
    clickhouse,
    operatorReads,
    encryption,
    rateLimiter,
  }: Readonly<{
    prisma: Parameters<typeof PostgresGovernanceRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    /** The process cipher the ingestion-source store seals credentials with (CREDENTIALS_SECRET). */
    encryption: Encryption;
    rateLimiter: RateLimiter;
  }> &
    GovernanceOperatorReadsMember): GovernanceRepositories {
    return {
      ...PostgresGovernanceRepositories.create({ prisma, encryption }),
      rateLimits: RedisGovernanceRateLimitRepository.create(rateLimiter),
      suppressionSnapshot: PrismaSuppressionSnapshotRepository.create({ operatorReads }),
      activityMonitor: PrismaActivityMonitorRepository.create({
        prisma,
        clickhouse: memberGovernanceClickHouseResolver(clickhouse),
      }),
      costRollup: ClickHouseGovernanceCostRollupRepository.create(
        memberClickHouseResolver(clickhouse),
      ),
      costCharges: ClickHouseGovernanceCostChargeRepository.create(
        memberClickHouseResolver(clickhouse),
      ),
      ocsfEvents: ClickHouseOcsfEventsRepository.create(memberClickHouseResolver(clickhouse)),
      anomalySpend: ClickHouseAnomalySpendRepository.create(memberClickHouseResolver(clickhouse)),
      rollupErasure: ClickHouseRollupErasureRepository.create(clickhouse),
    };
  }
}
