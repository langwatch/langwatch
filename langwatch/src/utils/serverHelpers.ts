import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import { getServerAuthSession } from "~/server/auth";
import { appRouter } from "~/server/api/root";
import { prisma } from "../server/db";

async function createInnerTRPCContext(context: GetServerSidePropsContext) {
  // Server-side: must read the cookie via auth.api.getSession headers, not
  // the browser-bound BetterAuth client. The `~/utils/auth-client` getSession
  // helper has no access to the request and would always return null on the
  // server.
  const session = await getServerAuthSession({ req: context.req });
  return {
    prisma,
    session,
    req: undefined,
    res: undefined,
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  };
}

export async function getServerSideHelpers(context: GetServerSidePropsContext) {
  return createServerSideHelpers({
    router: appRouter,
    ctx: await createInnerTRPCContext(context),
  });
}
