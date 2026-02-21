import { createSubscriptionRouter } from "../../../../ee/billing";
import { env } from "~/env.mjs";
import { createTRPCRouter } from "../trpc";

type SubscriptionRouter = ReturnType<typeof createSubscriptionRouter>;

// SaaS-only: subscription management requires Stripe integration.
// Type asserted so AppRouter always includes the subscription shape.
export const subscriptionRouter: SubscriptionRouter = env.IS_SAAS
  ? createSubscriptionRouter()
  : (createTRPCRouter({}) as unknown as SubscriptionRouter);
