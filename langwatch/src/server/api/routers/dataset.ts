import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import slugify from "slugify";
import { nanoid } from "nanoid";

export const datasetRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string(), schema: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .mutation(async ({ ctx, input }) => {

      const slug =  slugify(input.name, { lower: true })

      const existingDataset = await ctx.prisma.dataset.findFirst({
        where: {
          slug: slug,
          projectId: input.projectId,
        },
      });

      if (existingDataset) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A dataset with this name already exists.",
        });
      }
  
        return ctx.prisma.dataset.create({
          data: {
            id: nanoid(),
            slug,
            name: input.name,
            schema: input.schema,
            projectId: input.projectId,
          },
        });    
    }),
    getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findMany({
        where: { projectId },
        orderBy: {  createdAt: 'desc' },
      });

      return datasets;
    }),   
});
