import type { GetServerSidePropsContext } from "next";
import { getSession } from "next-auth/react";
import { isAdmin } from "./isAdmin";

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  const session = await getSession(context);

  const user = (session?.user as any)?.impersonator ?? session?.user;
  if (!session || (user && !isAdmin(user))) {
    return {
      notFound: true,
    };
  }

  return {
    props: {},
  };
};
