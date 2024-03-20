import { timeseriesInput } from "../../../analytics/registry";
import {
  sharedFiltersInputSchema,
  type ApiConfig,
} from "../../../analytics/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { timeseries } from "./timeseriesHelpers";

export const getTimeseries = protectedProcedure
  .input(sharedFiltersInputSchema.extend(timeseriesInput.shape))
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    const apiConfig: ApiConfig = "TRPC";
    return timeseries(input, apiConfig);
  });
