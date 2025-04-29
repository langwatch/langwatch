import type { Awaitable, DefaultSession, Session } from "next-auth";
import { SubscriptionHandler } from "../server/subscriptionHandler";

import type {
  GetServerSidePropsContext,
  NextApiRequest,
  NextApiResponse,
} from "next";
import type { ProcedureRouterRecord } from "@trpc/server";
import type { NextRequest } from "next/server";

export interface RegistrationCbUser {
  name?: string | null;
  email?: string | null;
}

export interface RegistrationCbOrganization {
  phoneNumber?: string | null;
  orgName?: string | null;
  signUpData?: Partial<{
    featureUsage?: string | null;
    yourRole?: string | null;
    usage?: string | null;
    solution?: string | null;
    companySize?: string | null;
    utmCampaign?: string | null;
  }> | null;
}

export interface Dependencies {
  subscriptionHandler: typeof SubscriptionHandler;
  sessionHandler?: (params: {
    req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest;
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
  postRegistrationCallback?: (
    user: RegistrationCbUser,
    org: RegistrationCbOrganization
  ) => void | Promise<void>;
  planLimits?: (organizationId: string, plan: string) => void | Promise<void>;
}

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandler,
};

export default dependencies;
