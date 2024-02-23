import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";



import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { nanoid } from "nanoid";

import {chatMessageSchema} from "~/server/tracer/types.generated";


export const datasetRecordRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string(), input: z.array(chatMessageSchema), output: z.array(chatMessageSchema) }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .mutation(async ({ ctx, input }) => {

      const entry = {input: JSON.stringify(input.input), output: JSON.stringify(input.output)}


        return ctx.prisma.datasetRecord.create({
          data: {
            id: nanoid(),
            entry: entry,
            datasetId: input.datasetId,
          },
        });    
    }),
    // getAll: protectedProcedure
    // .input(z.object({ projectId: z.string() }))
    // .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    // .query(async ({ input, ctx }) => {
    //   const { projectId } = input;
    //   const prisma = ctx.prisma;

    //   const datasets = await prisma.dataset.findMany({
    //     where: { projectId },
    //     orderBy: {  createdAt: 'desc' },
    //   });

    //   return datasets;
    // }),   
});
