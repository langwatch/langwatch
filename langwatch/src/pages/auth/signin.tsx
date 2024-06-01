import { type GetServerSidePropsContext } from "next";
import { type Session } from "next-auth";
import { getSession, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function SignIn({ session }: { session: Session | null }) {
  const callbackUrl = useSearchParams().get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!session) {
      void signIn("auth0", { callbackUrl });
    }
  }, [session, callbackUrl]);

  return <div style={{ padding: "12px" }}>Redirecting to Sign in...</div>;
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
