import { type GetServerSidePropsContext } from "next";
import { type Session } from "next-auth";
import { getSession, signIn } from "next-auth/react";
import { useEffect } from "react";

export default function SignIn({ session }: { session: Session | null }) {
  useEffect(() => {
    if (!session) {
      void signIn("auth0");
    }
  }, [session]);

  return <div>Redirecting to Sign in...</div>;
}

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  const session = await getSession(context);

  if (session) {
    return {
      redirect: {
        destination: "/",
        permanent: false,
      },
    };
  }

  return {
    props: { session },
  };
};
