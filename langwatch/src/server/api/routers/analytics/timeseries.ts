import { timeseriesInput } from "../../../analytics/registry";
import { timeseries } from "../../../analytics/timeseries";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const getTimeseries = protectedProcedure
  .input(timeseriesInput)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    return timeseries(input);
  });
