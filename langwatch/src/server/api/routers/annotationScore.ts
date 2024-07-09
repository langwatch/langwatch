import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const annotationScoreRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        dataType: z.enum(["BOOLEAN", "CATEGORICAL", "LIKERT"]),
        description: z.string().optional().nullable(),
        options: z.object({}).optional().nullable(),
        category: z.array(z.string()).optional().nullable(),
        categoryExplanation: z.array(z.string()).optional().nullable(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANNOTATIONS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      type OptionType = { label: string; value: string };
      const options: OptionType[] = [];

      if (
        input.dataType === "CATEGORICAL" &&
        input.category &&
        input.categoryExplanation
      ) {
        for (let i = 0; i < input.category.length; i++) {
          if (input.category[i] !== "") {
            options.push({
              label: input.category[i]!,
              value: input.categoryExplanation[i]!,
            });
          }
        }
      }

      if (input.dataType === "BOOLEAN") {
        options.push(
          { label: "true", value: "true" },
          { label: "false", value: "false" }
        );
      }
      if (input.dataType === "LIKERT") {
        const likertScale = [
          "strongly agree",
          "agree",
          "disagree",
          "strongly disagree",
        ];
        likertScale.forEach((scale) => {
          options.push({ label: scale, value: scale });
        });
      }
      return ctx.prisma.annotationScore.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          name: input.name,
          dataType: input.dataType,
          description: input.description ?? "",
          options: options ?? {},
        },
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });
    }),
  getAllActive: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.findMany({
        where: { projectId: input.projectId, active: true },
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
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.annotationScore.update({
        where: { id: input.scoreId, projectId: input.projectId },
        data: { active: input.active },
      });
    }),
});
