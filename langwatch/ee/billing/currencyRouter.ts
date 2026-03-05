import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../src/server/api/trpc";
import { skipPermissionCheck } from "../../src/server/api/rbac";
import { detectCurrencyFromRequest } from "./utils/currency";

export const createCurrencyRouter = () => {
  return createTRPCRouter({
    detectCurrency: protectedProcedure
      .input(z.object({}).passthrough())
      .use(skipPermissionCheck)
      .query(async ({ ctx }) => {
        return detectCurrencyFromRequest(ctx.req);
      }),
  });
};
