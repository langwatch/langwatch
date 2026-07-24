import { z } from "zod";
import { sharedFiltersInputSchema } from "../../analytics/types";

export const tracesFilterInput = sharedFiltersInputSchema.extend({
  pageOffset: z.number().optional(),
  pageSize: z.number().optional(),
});

export const getAllForProjectInput = tracesFilterInput.extend({
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});
