import { createSubscriptionRouter } from "../../../../ee/billing";
import { env } from "~/env.mjs";
import { createTRPCRouter } from "../trpc";

export const subscriptionRouter = env.IS_SAAS
  ? createSubscriptionRouter()
  : createTRPCRouter({});
