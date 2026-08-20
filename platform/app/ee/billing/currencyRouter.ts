import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../src/server/api/trpc";
import { detectCurrencyFromRequest } from "./utils/currency";

export const createCurrencyRouter = () => {
  return createTRPCRouter({
    detectCurrency: protectedProcedure
      .input(z.object({}).passthrough())
      .noPermission({ reason: "currency catalog is public reference data" })
      .query(async ({ ctx }) => {
        return detectCurrencyFromRequest(ctx.req);
      }),
  });
};
