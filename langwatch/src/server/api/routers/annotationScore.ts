import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const annotationScoreRouter = createTRPCRouter({
  upsert: protectedProcedure
    .input(
      z.object({
        annotationScoreId: z.string().optional().nullable(),
        projectId: z.string(),
        name: z.string(),
        dataType: z.enum([
          "OPTION",
          "CHECKBOX",
          "BOOLEAN",
          "LIKERT",
          "CATEGORICAL",
        ]),
        description: z.string().optional().nullable(),
        options: z.object({}).optional().nullable(),
        category: z.array(z.string()).optional().nullable(),
        categoryExplanation: z.array(z.string()).optional().nullable(),
        radioCheckboxOptions: z.array(z.string()),
        defaultRadioOption: z.string().optional().nullable(),
        defaultCheckboxOption: z.array(z.string()).optional().nullable(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      type OptionType = { label: string; value: string; reason?: string };
      const options: OptionType[] = [];

      input.radioCheckboxOptions?.forEach((option) => {
        options.push({ label: option, value: option });
      });

      const data = {
        projectId: input.projectId,
        name: input.name,
        dataType: input.dataType,
        description: input.description ?? "",
        options: options ?? {},
        defaultValue: {
          value: input.defaultRadioOption ?? null,
          options: input.defaultCheckboxOption ?? null,
        },
        deletedAt: null,
      };

      const scoreId = input.annotationScoreId || nanoid();

      return ctx.prisma.annotationScore.upsert({
        where: { 
          id: scoreId,
          projectId: input.projectId 
        },
        update: data,
        create: {
          id: scoreId,
          ...data,
        },
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
    }),
  getAllActive: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.findMany({
        where: { projectId: input.projectId, active: true, deletedAt: null },
      });
    }),
  getById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scoreId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.findFirstOrThrow({
        where: { 
          id: input.scoreId,
          projectId: input.projectId,
          deletedAt: null,
        },
      });
    }),
  toggle: protectedProcedure
    .input(
      z.object({
        scoreId: z.string(),
        active: z.boolean(),
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.update({
        where: { id: input.scoreId, projectId: input.projectId },
        data: { active: input.active },
      });
    }),
  delete: protectedProcedure
    .input(
      z.object({
        scoreId: z.string(),
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.update({
        where: { id: input.scoreId, projectId: input.projectId },
        data: { deletedAt: new Date() },
      });
    }),
});
