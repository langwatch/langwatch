import type { Awaitable, DefaultSession, Session } from "next-auth";
import { SubscriptionHandler } from "../server/subscriptionHandler";
import type {
  GetServerSidePropsContext,
  NextApiRequest,
  NextApiResponse,
} from "next";

export interface Dependencies {
  subscriptionHandler: typeof SubscriptionHandler;
  sessionHandler?: (params: {
    session: any;
    user: any;
    sessionToken: string | undefined;
  }) => Awaitable<DefaultSession | Session | null>;
  extraPagesGetServerSideProps?: Record<
    string,
    (context: GetServerSidePropsContext) => any
  >;
  extraApiRoutes?: Record<
    string,
    (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse<any>>
  >;
}

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandler,
};

export default dependencies;
