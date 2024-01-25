import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import type { Project } from "@prisma/client";
import {
  OrganizationRoleGroup,
  checkUserPermissionForOrganization,
} from "../permission";

export const costsRouter = createTRPCRouter({
  getAggregatedCostsForOrganization: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
      })
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_VIEW
      )
    )
    .query(async ({ input, ctx }) => {
      const { startDate, endDate } = input;
      const prisma = ctx.prisma;

      // If end date is very close to now, force it to be now to fetch most recent data
      const endDate_ =
        new Date().getTime() - endDate < 1000 * 60 * 60
          ? new Date().getTime()
          : endDate;

      const userProjects = await prisma.project.findMany({
        where: {
          OR: [
            {
              team: {
                organizationId: input.organizationId,
                members: {
                  some: {
                    userId: ctx.session.user.id,
                  },
                },
              },
            },
            {
              team: {
                organizationId: input.organizationId,
                organization: {
                  members: {
                    some: {
                      userId: ctx.session.user.id,
                      role: "ADMIN",
                    },
                  },
                },
              },
            },
          ],
        },
      });
      const projectsById = userProjects.reduce(
        (acc, project) => ({ ...acc, [project.id]: project }),
        {} as Record<string, Project>
      );
      const projectIds = Object.keys(projectsById);

      // Perform two separate groupBy queries: one for TRACE_CHECK and one for other cost types
      const traceCheckCosts = await prisma.cost.groupBy({
        by: ["projectId", "costType", "referenceId", "costName", "currency"],
        where: {
          projectId: { in: projectIds },
          costType: "TRACE_CHECK",
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(endDate_),
          },
        },
        _sum: { amount: true },
        _count: { id: true },
      });

      const otherCosts = await prisma.cost.groupBy({
        by: ["projectId", "costType", "currency"],
        where: {
          projectId: { in: projectIds },
          NOT: {
            costType: "TRACE_CHECK",
          },
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(endDate_),
          },
        },
        _sum: { amount: true },
        _count: { id: true },
      });

      type Unpacked<T> = T extends (infer U)[] ? U : T;

      // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
      const aggregatedCosts: (Unpacked<typeof otherCosts> & {
        referenceId?: string;
        costName?: string;
      })[] = [...traceCheckCosts, ...otherCosts];

      const aggregatedCostsByProject = aggregatedCosts.reduce(
        (acc, cost) => {
          const project = projectsById[cost.projectId];
          if (!project) return acc;

          const projectCosts = acc[cost.projectId] ?? {
            project,
            costs: [],
          };

          projectCosts.costs.push(cost);

          return {
            ...acc,
            [cost.projectId]: projectCosts,
          };
        },
        {} as Record<
          string,
          {
            project: Project;
            costs: typeof aggregatedCosts;
          }
        >
      );

      return Object.values(aggregatedCostsByProject);
    }),
});
