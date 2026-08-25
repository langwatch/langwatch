import { sharedFiltersInputSchema } from "../../../analytics/types";
import { protectedProcedure } from "../../trpc";

export const topUsedDocuments = protectedProcedure
  .input(sharedFiltersInputSchema)
  .permission("cost:view")
  .query(async ({ input, ctx }) => {
    const analyticsService = ctx.app.analytics;
    return analyticsService.getTopUsedDocuments(input);
  });
