import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { type DatasetRecord } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { newDatasetEntriesSchema } from "../../datasets/types";

export const datasetRecordRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.intersection(
        z.object({
          projectId: z.string(),
          datasetId: z.string(),
        }),
        newDatasetEntriesSchema
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const dataset = await ctx.prisma.dataset.findFirst({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
          schema: input.schema,
        },
      });

      if (!dataset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dataset not found",
        });
      }

      const recordData: DatasetRecord[] = [];

      for (const entry of input.entries) {
        const id = entry.id;
        const entryWithoutId: Omit<typeof entry, "id"> = { ...entry };
        // @ts-ignore
        delete entryWithoutId.id;

        recordData.push({
          id,
          entry: entryWithoutId,
          datasetId: input.datasetId,
          createdAt: new Date(),
          updatedAt: new Date(),
          projectId: input.projectId,
        });
      }

      return ctx.prisma.datasetRecord.createMany({
        data: recordData as (DatasetRecord & { entry: any })[],
      });
    }),
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        recordId: z.string(),
        updatedRecord: z.object({
          input: z.nullable(z.optional(z.string())),
          expected_output: z.nullable(z.optional(z.string())),
          spans: z.optional(z.string()),
          contexts: z.optional(z.string()),
          llm_input: z.optional(z.string()),
          expected_llm_output: z.optional(z.string()),
          comments: z.nullable(z.optional(z.string())),
        }),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const dataset = await ctx.prisma.dataset.findFirst({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
      });

      if (!dataset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dataset not found",
        });
      }

      const { recordId, updatedRecord } = input;

      const record = await ctx.prisma.datasetRecord.findUnique({
        where: { id: recordId, projectId: dataset.projectId },
      });

      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Record not found",
        });
      }

      const updatedData: any = {};
      for (const key in updatedRecord) {
        if (
          key === "input" ||
          key === "expected_output" ||
          key === "comments"
        ) {
          updatedData[key] = updatedRecord[key] ?? "";
        } else if ((updatedRecord as any)[key]) {
          updatedData[key] = JSON.parse((updatedRecord as any)[key] as string);
        }
      }

      await ctx.prisma.datasetRecord.update({
        where: { id: recordId, projectId: dataset.projectId },
        data: {
          entry: updatedData,
        },
      });

      return { success: true };
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findFirst({
        where: { id: input.datasetId, projectId: input.projectId },
        include: {
          datasetRecords: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      return datasets;
    }),
});
