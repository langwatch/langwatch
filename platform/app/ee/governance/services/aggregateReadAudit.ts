// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "~/generated/prisma/client";
import type { ProjectKindReader } from "~/server/app-layer/permissions/aggregate-admin-gate";
import {
  type AggregateReadAudit,
  DedupedAggregateReadAudit,
} from "~/server/app-layer/projects/aggregate-read-audit";
import {
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  AdminWorkspaceViewAuditService,
} from "./adminWorkspaceViewAudit.service";
import type { GovernanceOcsfEventsClickHouseRepository } from "./governanceOcsfEvents.clickhouse.repository";

/**
 * The enterprise half of the aggregate read audit (ADR-144 decision 9):
 * every read of an aggregate writes the admin workspace view row of kind
 * `aggregate`, behind the per-process window. The window and the row read
 * one clock. The in-process window opens when this pod asks, even when the
 * database answers that another pod's row already covers the read, so across
 * pods it can outlast the database's by up to one window: under continuous
 * reads, rows land up to two windows apart.
 */
export function workspaceViewAggregateReadAudit({
  prisma,
  ocsfRepository,
  kinds,
  now = () => new Date(),
}: {
  prisma: PrismaClient;
  ocsfRepository?: GovernanceOcsfEventsClickHouseRepository;
  kinds?: ProjectKindReader;
  now?: () => Date;
}): AggregateReadAudit {
  const service = AdminWorkspaceViewAuditService.create({
    prisma,
    ocsfRepository,
    kinds,
    now,
  });
  return new DedupedAggregateReadAudit({
    inner: {
      recordAggregateRead: async (read) => {
        await service.recordView({
          kind: "aggregate",
          actorUserId: read.actorUserId,
          organizationId: read.organizationId,
          targetProjectId: read.aggregateProjectId,
        });
      },
    },
    windowMs: ADMIN_WORKSPACE_VIEW_DEDUP_MS,
    now: () => now().getTime(),
  });
}
