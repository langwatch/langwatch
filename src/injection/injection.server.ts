import type { Dependencies } from "../../langwatch/langwatch/src/injection/injection.server";
import { prisma } from "../../langwatch/langwatch/src/server/db";
import { getServerSideProps as adminGetServerSideProps } from "../pages/admin";
import { SubscriptionHandlerSaas } from "../subscriptionHandler";
import { getNextAuthSessionToken, isAdmin } from "../utils/auth";
import adminResource from "../pages/extra_api/admin/[resource]";
import impersonate from "../pages/extra_api/admin/impersonate";
import stripeWebhook from "../pages/extra_api/webhooks/stripe";
import { subscriptionRouter } from "../pages/extra_api/api/subscription";
import { PostRegistrationCallback } from "../postRegistrationCallback";
import demoBot from "../pages/extra_api/demo/hotel_bot";

if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error(
    "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars must be set"
  );
}

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandlerSaas,
  sessionHandler: async ({ req, session, user }) => {
    const sessionToken = getNextAuthSessionToken(req);
    if (!isAdmin(user) || !sessionToken) return null;

    const dbSession = await prisma.session.findUnique({
      where: { sessionToken },
    });

    if (
      dbSession?.impersonating &&
      typeof dbSession?.impersonating === "object"
    ) {
      return {
        ...session,
        user: {
          ...(dbSession.impersonating as any),
          impersonator: {
            ...session.user,
            ...user,
          },
        },
      };
    }

    return null;
  },
  extraPagesGetServerSideProps: {
    "/admin": adminGetServerSideProps,
  },
  extraApiRoutes: {
    "/api/admin/impersonate": impersonate,
    "/api/admin/:resource": adminResource,
    "/api/webhooks/stripe": stripeWebhook,
    "/api/demo/hotel_bot": demoBot,
  },
  extraTRPCRoutes: () => ({
    subscription: subscriptionRouter(),
  }),
  postRegistrationCallback: PostRegistrationCallback,
};

export default dependencies;
