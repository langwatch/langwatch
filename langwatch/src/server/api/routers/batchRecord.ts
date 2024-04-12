import { type DatabaseSchema } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import slugify from "slugify";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

/*
batchId   String
    projectId String
    project   Project  @relation(fields: [projectId], references: [id])
    status    String
    score     Float
    passed    Boolean
    details   String
    cost      Float
    name      String
    slug      String
*/

export const batchRecordRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const batchRecords = await prisma.batchProcessing.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });

      return batchRecords;
    }),
});
