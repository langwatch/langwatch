import { createTRPCRouter } from "~/server/api/trpc";
import { dataForFilter } from "./analytics/dataForFilter";
import { topUsedDocuments } from "./analytics/documents";
import { feedbacks } from "./analytics/feedbacks";
import { governedSqlRouter } from "./analytics/governedSql";
import { getTimeseries } from "./analytics/timeseries";

export const analyticsRouter = createTRPCRouter({
  getTimeseries,
  dataForFilter,
  topUsedDocuments,
  feedbacks,
  governedSql: governedSqlRouter,
});
