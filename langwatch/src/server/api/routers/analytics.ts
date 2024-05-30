import { createTRPCRouter } from "~/server/api/trpc";
import { dataForFilter } from "./analytics/dataForFilter";
import { topUsedDocuments } from "./analytics/documents";
import { feedbacks } from "./analytics/feedbacks";
import { sessionsVsPreviousPeriod } from "./analytics/sessions";
import { getTimeseries } from "./analytics/timeseries";

export const analyticsRouter = createTRPCRouter({
  getTimeseries,
  dataForFilter,
  sessionsVsPreviousPeriod,
  topUsedDocuments,
  feedbacks,
});
