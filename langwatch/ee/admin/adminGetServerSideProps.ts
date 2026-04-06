import type { GetServerSidePropsContext } from "next";
import { getSession } from "next-auth/react";
import { isAdmin } from "./isAdmin";

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  const session = await getSession(context);

  if (!session || (session.user && !isAdmin(session.user))) {
    return {
      notFound: true,
    };
  }

  return {
    props: {},
  };
};
