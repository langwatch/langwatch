import type { Awaitable, DefaultSession, Session } from "next-auth";
import { SubscriptionHandler } from "../server/subscriptionHandler";

import type {
  GetServerSidePropsContext,
  NextApiRequest,
  NextApiResponse,
} from "next";
import type { ProcedureRouterRecord } from "@trpc/server";

export interface Dependencies {
  subscriptionHandler: typeof SubscriptionHandler;
  sessionHandler?: (params: {
    req: NextApiRequest | GetServerSidePropsContext["req"];
    session: any;
    user: any;
  }) => Awaitable<DefaultSession | Session | null>;
  extraPagesGetServerSideProps?: Record<
    string,
    (context: GetServerSidePropsContext) => any
  >;
  extraApiRoutes?: Record<
    string,
    (
      req: NextApiRequest,
      res: NextApiResponse
    ) => Promise<void | NextApiResponse<any>>
  >;
  extraTRPCRoutes?: () => ProcedureRouterRecord;
  postRegistrationCallback?: (user: any, org: any) => void | Promise<void>;
}

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandler,
};

export default dependencies;
