import { createCurrencyRouter } from "../../../../ee/billing/currencyRouter";
import { env } from "~/env.mjs";
import { createTRPCRouter } from "../trpc";

type CurrencyRouter = ReturnType<typeof createCurrencyRouter>;

// SaaS-only: currency detection requires geo-IP headers from the CDN.
// Type asserted so AppRouter always includes the currency shape.
export const currencyRouter: CurrencyRouter = env.IS_SAAS
  ? createCurrencyRouter()
  : (createTRPCRouter({}) as unknown as CurrencyRouter);
