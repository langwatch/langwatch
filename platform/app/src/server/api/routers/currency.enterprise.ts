import { z } from "zod";
import { CurrencyService } from "~/runtime/app/features/billing";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const createCurrencyRouter = () => {
  const currencyService = CurrencyService.create();
  return createTRPCRouter({
    detectCurrency: protectedProcedure
      .input(z.object({}).passthrough())
      .noPermission({ reason: "currency catalog is public reference data" })
      .query(async ({ ctx }) => {
        return currencyService.detect(ctx.req);
      }),
  });
};
