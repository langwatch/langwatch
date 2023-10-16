import {
  type GetServerSidePropsResult,
  type GetServerSidePropsContext,
} from "next";
import { getSession } from "next-auth/react";
import { type Session } from "next-auth";
import { type ParsedUrlQuery } from "querystring";
import { FullyLoadedOrganization } from "../server/api/routers/organization";
import { getServerSideHelpers } from "./serverHelpers";

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
  ): Promise<GetServerSidePropsResult<U & { user: Session["user"] }>> => {
    const session = await getSession(context);

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
        user: session.user,
      },
    };
  };
}

export function withSignedInUserAndData<
  T extends ParsedUrlQuery,
  U extends Record<string, any>,
>(
  fn: (
    context: GetServerSidePropsContext<T>
  ) => Promise<GetServerSidePropsResult<U>>
) {
  return async (
    context: GetServerSidePropsContext<T>
  ): Promise<
    GetServerSidePropsResult<
      U & { user: Session["user"]; organizations: FullyLoadedOrganization[] }
    >
  > => {
    const data = await withSignedInUser(fn)(context);

    if (!hasProps(data)) return data;

    const helpers = await getServerSideHelpers(context);
    const organizations: FullyLoadedOrganization[] =
      await helpers.organization.getAll.fetch();

    if (organizations.length == 0) {
      return {
        redirect: {
          destination: "/onboarding/organization",
          permanent: false,
        },
      };
    }

    if (
      organizations.every((org) =>
        org.teams.every((team) => team.projects.length == 0)
      )
    ) {
      const firstTeamSlug = organizations.flatMap((org) => org.teams)[0]?.slug;
      return {
        redirect: {
          destination: `/onboarding/${firstTeamSlug}/project`,
          permanent: false,
        },
      };
    }

    return {
      ...data,
      props: {
        ...(await data.props),
        organizations,
      },
    };
  };
}

export function hasProps(obj: any): obj is { props: Record<string, any> } {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return !!obj.props;
}
