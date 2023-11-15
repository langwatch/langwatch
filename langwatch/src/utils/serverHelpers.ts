import { getSession } from "next-auth/react";

import { createServerSideHelpers } from "@trpc/react-query/server";
import { type GetServerSidePropsContext } from "next";
import { appRouter } from "~/server/api/root";
import { prisma } from "../server/db";

async function createInnerTRPCContext(context: GetServerSidePropsContext) {
  const session = await getSession(context);
  return {
    prisma,
    session,
    req: undefined,
    res: undefined,
  };
}

export async function getServerSideHelpers(context: GetServerSidePropsContext) {
  return createServerSideHelpers({
    router: appRouter,
    ctx: await createInnerTRPCContext(context),
  });
}
