import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAnalyticsService } from "../../../analytics/analytics.service";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { availableFilters } from "../../../filters/registry";
import { filterFieldsEnum } from "../../../filters/types";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const dataForFilter = protectedProcedure
  .input(
    sharedFiltersInputSchema.extend({
      field: filterFieldsEnum,
      key: z.string().optional(),
      subkey: z.string().optional(),
      query: z.string().optional(),
    }),
  )
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    const { field, key, subkey } = input;

    const filterConfig = availableFilters[field]!;

    if (filterConfig.requiresKey && !key) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a key to be defined`,
      });
    }

    if (filterConfig.requiresSubkey && !subkey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a subkey to be defined`,
      });
    }

    const analyticsService = getAnalyticsService();
    return analyticsService.getDataForFilter(
      input.projectId,
      field,
      input.startDate,
      input.endDate,
      input.filters,
      key,
      subkey,
      input.query,
    );
  });
