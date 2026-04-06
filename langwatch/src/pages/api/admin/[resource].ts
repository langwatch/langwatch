import {
  defaultHandler,
  getListHandler,
  type GetListRequest,
} from "ra-data-simple-prisma";
import { prisma } from "~/server/db";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";
import { isAdmin } from "../../../../ee/admin/isAdmin";
import { auditLog } from "~/server/auditLog";
import { PlanTypes, SubscriptionStatus } from "@prisma/client";
import type { Organization, Prisma, Project, Team, User } from "@prisma/client";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerAuthSession({ req, res });
  const user = (session?.user as any)?.impersonator ?? session?.user;
  if (!session || (session && !isAdmin(user))) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (req.body.resource === "organizations") {
    req.body.resource = "organization";
  }

  if (req.body.resource === "organizationFeatures") {
    req.body.resource = "organizationFeature";
  }

  if (req.body.resource === "subscriptions") {
    req.body.resource = "subscription";
  }

  if (req.body.resource === "teams") {
    req.body.resource = "team";
  }

  if (req.body.resource === "user" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const result = await getListHandler<Prisma.UserFindManyArgs>(
      req.body as GetListRequest,
      prisma.user,
      {
        ...(query
          ? {
              where: {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                  {
                    orgMemberships: {
                      some: {
                        organization: {
                          name: { contains: query, mode: "insensitive" },
                        },
                      },
                    },
                  },
                  {
                    teamMemberships: {
                      some: {
                        team: {
                          projects: {
                            some: {
                              name: { contains: query, mode: "insensitive" },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            }
          : {}),
        include: {
          orgMemberships: {
            include: {
              organization: true,
            },
          },
          teamMemberships: {
            include: {
              team: {
                include: {
                  projects: true,
                },
              },
            },
          },
        },
        map: (
          users: (User & {
              orgMemberships: { organization: Organization }[];
              teamMemberships: { team: Team & { projects: Project[] } }[];
            })[]
        ) => {
          return users.map((user) => ({
            ...user,
            organizations: user.orgMemberships
              ?.map((orgMembership) => orgMembership.organization.name)
              .join(", "),
            teams: user.teamMemberships
              ?.map((teamMembership) => teamMembership.team.name)
              .join(", "),
            projects: user.teamMemberships
              ?.flatMap((teamMembership) =>
                teamMembership.team.projects?.map((project) => project.name)
              )
              .join(", "),
          }));
        },
      }
    );
    res.json(result);
    return;
  }

  if (req.body.resource === "organization" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const result = await getListHandler<Prisma.OrganizationFindManyArgs>(
      req.body as GetListRequest,
      prisma.organization,
      {
        ...(query
          ? {
              where: {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { slug: { contains: query, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      }
    );
    res.json(result);
    return;
  }

  if (req.body.resource === "project" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const result = await getListHandler<Prisma.ProjectFindManyArgs>(
      req.body as GetListRequest,
      prisma.project,
      {
        ...(query
          ? {
              where: {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { slug: { contains: query, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      }
    );
    res.json(result);
    return;
  }

  if (req.body.resource === "subscription" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const upperQuery = query?.toUpperCase();
    const matchingPlan = upperQuery
      ? Object.values(PlanTypes).find((p) => p === upperQuery)
      : undefined;
    const matchingStatus = upperQuery
      ? Object.values(SubscriptionStatus).find((s) => s === upperQuery)
      : undefined;

    const orFilters: Prisma.SubscriptionWhereInput[] = [];
    if (query) {
      orFilters.push({
        stripeSubscriptionId: { contains: query, mode: "insensitive" },
      });
      orFilters.push({
        organization: {
          name: { contains: query, mode: "insensitive" },
        },
      });
      if (matchingPlan) {
        orFilters.push({ plan: { equals: matchingPlan } });
      }
      if (matchingStatus) {
        orFilters.push({ status: { equals: matchingStatus } });
      }
    }

    const result = await getListHandler<Prisma.SubscriptionFindManyArgs>(
      req.body as GetListRequest,
      prisma.subscription,
      {
        where: orFilters.length > 0 ? { OR: orFilters } : {},
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }
    );
    res.json(result);
    return;
  }

  const result = await defaultHandler(req.body, prisma as any, {
    audit: {
      model: {
        create: async ({
          data,
        }: {
          data: {
            action: string;
            resource: string;
            payload: object;
            author: {
              connect: {
                id: string;
              };
            };
          };
        }) => {
          await auditLog({
            userId: data.author.connect.id,
            action: `admin/${data.action}/${data.resource}`,
            args: data.payload,
            req,
          });
        },
      },
      authProvider: {
        getIdentity: async () => {
          return {
            id: user?.id ?? session?.user.id,
            fullName: user?.name ?? session?.user.name,
          };
        },
      } as any,
    },
  });

  res.json(result);
}
