import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../src/server/api/trpc";
import { skipPermissionCheck } from "../../src/server/api/rbac";
import { getCurrencyFromCountry } from "./utils/currency";

export const createCurrencyRouter = () => {
  return createTRPCRouter({
    detectCurrency: protectedProcedure
      .input(z.object({}).passthrough())
      .use(skipPermissionCheck)
      .query(async ({ ctx }) => {
      // Try to get country from request headers (X-Vercel-IP-Country, CF-IPCountry, etc.)
      const headers = ctx.req?.headers;
      const country =
        (headers?.["x-vercel-ip-country"] as string | undefined) ??
        (headers?.["cf-ipcountry"] as string | undefined) ??
        null;

      return { currency: getCurrencyFromCountry(country) };
    }),
  });
};
