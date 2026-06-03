import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { FilterParam } from "~/hooks/useFilterParams";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { FilterService } from "../../../filters/filter.service";
import { availableFilters } from "../../../filters/registry";
import { type FilterField, filterFieldsEnum } from "../../../filters/types";
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

    // Exclude the current field from scope filters to avoid circular dependency
    const scopeFilters = Object.fromEntries(
      Object.entries(input.filters).filter(([key]) => key !== field),
    ) as Partial<Record<FilterField, FilterParam>>;

    const filterService = FilterService.create(ctx.prisma);
    const results = await filterService.getFilterOptions({
      projectId: input.projectId,
      field,
      query: input.query,
      key,
      subkey,
      startDate: input.startDate,
      endDate: input.endDate,
      scopeFilters,
    });

    return { options: results };
  });
