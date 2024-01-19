import { type GetServerSidePropsContext, type NextPage } from "next";
import { getSession } from "next-auth/react";
import dynamic from "next/dynamic";
import { isAdmin } from "../../utils/auth";

const AdminApp = dynamic(() => import("../../components/AdminApp"), {
  ssr: false,
});

const Home: NextPage = () => <AdminApp />;

export default Home;

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
