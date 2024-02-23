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

      const entry = {input: input.input, output: input.output}
        return ctx.prisma.datasetRecord.create({
          data: {
            id: nanoid(),
            entry: entry,
            datasetId: input.datasetId,
          },
        });    
    }),
    getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findFirst({
        where: { id: input.datasetId},
        include: {
          datasetRecords: {
            orderBy: {  createdAt: 'desc' },
          }
        },
      });

      return datasets;
    }),   
});
