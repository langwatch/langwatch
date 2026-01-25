import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { FilterServiceFacade } from "../../../filters/filter.service";
import { availableFilters } from "../../../filters/registry";
import { filterFieldsEnum } from "../../../filters/types";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";
import { generateTracesPivotQueryConditions } from "./common";

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
  .query(async ({ input, ctx }) => {
    const { field, key, subkey } = input;

    if (availableFilters[field].requiresKey && !key) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a key to be defined`,
      });
    }

    if (availableFilters[field].requiresSubkey && !subkey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Field ${field} requires a subkey to be defined`,
      });
    }

    const { pivotIndexConditions } = generateTracesPivotQueryConditions({
      ...input,
      filters: {
        ...(input.filters["topics.topics"]
          ? { "topics.topics": input.filters["topics.topics"] }
          : {}),
      },
    });

    const filterService = FilterServiceFacade.create(ctx.prisma);
    const results = await filterService.getFilterOptions({
      projectId: input.projectId,
      field,
      query: input.query,
      key,
      subkey,
      startDate: input.startDate,
      endDate: input.endDate,
      pivotIndexConditions,
    });

    return { options: results };
  });
