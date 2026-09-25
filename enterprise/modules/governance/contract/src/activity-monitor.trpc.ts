// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `activityMonitor.*` procedure, declared once, at main's wire names and defaults. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  activityEventDetailRowSchema,
  activityMonitorSummarySchema,
  governanceSortDirectionSchema,
  ingestionSourceHealthRowSchema,
  recentAnomalyRowSchema,
  sourceHealthMetricsSchema,
  spendByDepartmentRowSchema,
  spendByTeamRowSchema,
  spendByUserRowSchema,
  spendOverTimeGroupBySchema,
  spendOverTimeResultSchema,
  spendSortFieldSchema,
} from "./ingestion-source-activity.queries.ts";

const organizationScope = z.object({ organizationId: z.string() });
const windowQuery = z.object({
  ...organizationScope.shape,
  windowDays: z.number().int().min(1).max(365).default(30),
});
const pagedWindowQuery = z.object({
  ...windowQuery.shape,
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: spendSortFieldSchema.default("spend"),
  sortDir: governanceSortDirectionSchema.default("desc"),
});
const sourceInOrganization = z.object({ ...organizationScope.shape, sourceId: z.string() });

export const activityMonitorTrpc = defineTrpcContract("activityMonitor")
  .query("summary")
  .withInput(windowQuery)
  .withOutput(activityMonitorSummarySchema)

  .query("spendByUser")
  .withInput(pagedWindowQuery)
  .withOutput(spendByUserRowSchema.array())

  .query("spendByTeam")
  .withInput(pagedWindowQuery)
  .withOutput(spendByTeamRowSchema.array())

  .query("spendByDepartment")
  .withInput(windowQuery)
  .withOutput(spendByDepartmentRowSchema.array())

  .query("spendOverTime")
  .withInput(
    z.object({ ...windowQuery.shape, groupBy: spendOverTimeGroupBySchema.default("team") }),
  )
  .withOutput(spendOverTimeResultSchema)

  .query("ingestionSourcesHealth")
  .withInput(organizationScope)
  .withOutput(ingestionSourceHealthRowSchema.array())

  .query("recentAnomalies")
  .withInput(
    z.object({ ...organizationScope.shape, limit: z.number().int().min(1).max(200).default(50) }),
  )
  .withOutput(recentAnomalyRowSchema.array())

  .query("eventsForSource")
  .withInput(
    z.object({
      ...sourceInOrganization.shape,
      limit: z.number().int().min(1).max(200).default(50),
      beforeIso: z.string().optional(),
    }),
  )
  .withOutput(activityEventDetailRowSchema.array())

  .query("sourceHealthMetrics")
  .withInput(sourceInOrganization)
  .withOutput(sourceHealthMetricsSchema)
  .build();
