import { nanoid } from "nanoid";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const annotationScoreRouter = createTRPCRouter({
  upsert: protectedProcedure
    .input(
      z.object({
        annotationScoreId: z.string().optional().nullable(),
        projectId: z.string(),
        name: z.string(),
        dataType: z.enum(["OPTION", "CHECKBOX", "BOOLEAN", "LIKERT", "CATEGORICAL"]),
        description: z.string().optional().nullable(),
        options: z.array(z.string()).optional().nullable(),
        category: z.array(z.string()).optional().nullable(),
        categoryExplanation: z.array(z.string()).optional().nullable(),
        radioCheckboxOptions: z.array(z.string()),
        defaultRadioOption: z.string().optional().nullable(),
        defaultCheckboxOption: z.array(z.string()).optional().nullable(),
      }),
    )
    .permission("annotations:manage")
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
        options,
        defaultValue: {
          value: input.defaultRadioOption ?? null,
          options: input.defaultCheckboxOption ?? null,
        },
      };

      const scoreId = input.annotationScoreId || nanoid();

      return ctx.app.annotations.upsertScore({
        id: scoreId,
        projectId: input.projectId,
        name: data.name,
        dataType: data.dataType,
        description: data.description,
        options: data.options,
        defaultValue: data.defaultValue,
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.app.annotations.listScores({ projectId: input.projectId });
    }),
  getAllActive: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.app.annotations.listScores({
        projectId: input.projectId,
        activeOnly: true,
      });
    }),
  getById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scoreId: z.string(),
      }),
    )
    .permission("annotations:view")
    .query(async ({ ctx, input }) => {
      return ctx.app.annotations.getScore({
        id: input.scoreId,
        projectId: input.projectId,
      });
    }),
  toggle: protectedProcedure
    .input(
      z.object({
        scoreId: z.string(),
        active: z.boolean(),
        projectId: z.string(),
      }),
    )
    .permission("annotations:update")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.annotations.toggleScore({
        id: input.scoreId,
        projectId: input.projectId,
        active: input.active,
      });
    }),
  delete: protectedProcedure
    .input(
      z.object({
        scoreId: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("annotations:delete")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.annotations.deleteScore({
        id: input.scoreId,
        projectId: input.projectId,
      });
    }),
});
