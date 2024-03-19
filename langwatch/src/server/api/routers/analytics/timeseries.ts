import type {
  AggregationsAggregationContainer,
  MappingRuntimeField,
} from "@elastic/elasticsearch/lib/api/types";
import { TRPCError } from "@trpc/server";
import { getGroup, getMetric } from "~/server/analytics/registry";
import {
  analyticsPipelines,
  pipelineAggregationsToElasticSearch,
  timeseriesInput,
  type FlattenAnalyticsGroupsEnum,
  type SeriesInputType,
} from "../../../analytics/registry";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { TRACES_PIVOT_INDEX, esClient } from "../../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousDates,
  generateTracesPivotQueryConditions,
} from "./common";
import { prisma } from "../../../db";
import type { SearchRequest } from "@elastic/elasticsearch/lib/api/typesWithBodyKey";
import { timeseries } from "./test";
import { type ApiConfig } from "../../../analytics/types";

export const getTimeseries = protectedProcedure
  .input(sharedFiltersInputSchema.extend(timeseriesInput.shape))
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    const apiConfig: ApiConfig = "TRPC";
    return timeseries(input, apiConfig);
  });
