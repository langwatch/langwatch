import type { GetServerSidePropsContext } from "~/types/next-stubs";
import { getServerAuthSession } from "~/server/auth";
import { isAdmin } from "./isAdmin";

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  // Use the server-side helper that reads cookies from request headers.
  // The browser-bound `~/utils/auth-client` getSession helper has no access
  // to the request and would always return null in getServerSideProps,
  // 404'ing every admin page load.
  const session = await getServerAuthSession({ req: context.req });

  // When impersonating, `session.user` is the target and
  // `session.user.impersonator` is the real admin; always gate admin
  // pages on the impersonator identity so permission checks aren't
  // routed through the impersonated user.
  const user = session?.user.impersonator ?? session?.user;
  if (!session || !user || !isAdmin(user)) {
    return {
      notFound: true,
    };
  }

  return {
    props: {},
  };
};
