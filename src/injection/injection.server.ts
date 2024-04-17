import type { Dependencies } from "../../langwatch/langwatch/src/injection/injection.server";
import { prisma } from "../../langwatch/langwatch/src/server/db";
import { getServerSideProps as adminGetServerSideProps } from "../pages/admin";
import { SubscriptionHandlerSass } from "../subscriptionHandler";
import { getNextAuthSessionToken, isAdmin } from "../utils/auth";
import adminResource from "../pages/extra_api/admin/[resource]";
import impersonate from "../pages/extra_api/admin/impersonate";
import { subscriptionRouter } from "../pages/extra_api/api/subscription";

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandlerSass,
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
  },
  extraTRPCRoutes: () => ({
    subscription: subscriptionRouter(),
  }),
};

export default dependencies;
