import {
  type GetServerSidePropsContext,
  type GetServerSidePropsResult,
} from "next";
import { type Session } from "next-auth";
import { type ParsedUrlQuery } from "querystring";
import { getServerAuthSession } from "./auth";

export function withSignedInUser<
  T extends ParsedUrlQuery,
  U extends Record<string, any>,
>(
  fn: (
    context: GetServerSidePropsContext<T>
  ) => Promise<GetServerSidePropsResult<U>>
) {
  return async (
    context: GetServerSidePropsContext<T>
  ): Promise<GetServerSidePropsResult<U & { session: Session }>> => {
    const session = await getServerAuthSession(context);

    if (!session) {
      return {
        redirect: {
          destination: "/auth/signin",
          permanent: false,
        },
      };
    }

    const data = await fn(context);

    if (!hasProps(data)) return data;

    return {
      ...data,
      props: {
        ...(await data.props),
        session,
      },
    };
  };
}

export function hasProps(obj: any): obj is { props: Record<string, any> } {
  return !!obj.props;
}
