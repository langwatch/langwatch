import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import {
  datasetRecordEntrySchema,
  datasetRecordFormSchema,
} from "../../datasets/types.generated";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { createManyDatasetRecords } from "./datasetRecord";
import { tryToMapPreviousColumnsToNewColumns } from "../../../optimization_studio/utils/datasetUtils";
import type { DatasetColumns, DatasetRecordEntry } from "../../datasets/types";
import { prisma } from "../../db";
import { slugify } from "../../../utils/slugify";

const getOrgCanUseS3FromProject = async (projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { organization: true } } },
  });

  return {
    canUseS3: project?.team?.organization?.useCustomS3,
  };
};

export const datasetRouter = createTRPCRouter({
  upsert: protectedProcedure
    .input(
      z.intersection(
        z.object({
          projectId: z.string(),
          datasetRecords: z.array(datasetRecordEntrySchema).optional(),
        }),
        z.union([
          datasetRecordFormSchema.extend({
            datasetId: z.string().optional(),
          }),
          datasetRecordFormSchema
            .omit({
              name: true,
            })
            .extend({
              experimentId: z.string(),
            }),
        ])
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      if ("datasetId" in input && input.datasetId) {
        const existingDataset = await ctx.prisma.dataset.findFirst({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
        });

        if (!existingDataset) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Dataset not found.",
          });
        }

        if (
          JSON.stringify(existingDataset.columnTypes) !==
          JSON.stringify(input.columnTypes)
        ) {
          const datasetRecords = await ctx.prisma.datasetRecord.findMany({
            where: {
              datasetId: input.datasetId,
              projectId: input.projectId,
            },
          });

          const updatedEntries = tryToMapPreviousColumnsToNewColumns(
            datasetRecords.map((record) => record.entry as DatasetRecordEntry),
            existingDataset.columnTypes as DatasetColumns,
            input.columnTypes
          );

          await ctx.prisma.$transaction(
            datasetRecords.map((record, index) =>
              ctx.prisma.datasetRecord.update({
                where: {
                  id: record.id,
                  datasetId: input.datasetId,
                  projectId: input.projectId,
                },
                data: {
                  entry: updatedEntries[index],
                },
              })
            )
          );
        }

        return await ctx.prisma.dataset.update({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
          data: {
            name: input.name,
            columnTypes: input.columnTypes,
          },
        });
      }

      const name =
        "name" in input
          ? input.name
          : await findNextDatasetNameForExperiment(
              input.projectId,
              input.experimentId
            );

      const slug = slugify(name.replace("_", "-"), {
        lower: true,
        strict: true,
      });

      const existingDataset = await ctx.prisma.dataset.findFirst({
        where: {
          slug: slug,
          projectId: input.projectId,
        },
      });

      if (existingDataset) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A dataset with this name already exists.",
        });
      }

      const { canUseS3 } = await getOrgCanUseS3FromProject(input.projectId);

      const dataset = await ctx.prisma.dataset.create({
        data: {
          id: `dataset_${nanoid()}`,
          slug,
          name,
          projectId: input.projectId,
          columnTypes: input.columnTypes,
          useS3: canUseS3,
        },
      });

      if (input.datasetRecords) {
        await createManyDatasetRecords({
          datasetId: dataset.id,
          projectId: input.projectId,
          datasetRecords: input.datasetRecords,
        });
      }

      return dataset;
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findMany({
        where: { projectId, archivedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { datasetRecords: true },
          },
        },
      });

      return datasets;
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId, datasetId } = input;
      const dataset = await ctx.prisma.dataset.findFirst({
        where: { id: datasetId, projectId, archivedAt: null },
      });
      return dataset;
    }),
  deleteById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        undo: z.boolean().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const datasetName = (
        await ctx.prisma.dataset.findFirst({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
        })
      )?.name;
      const slug = slugify(datasetName ?? "");

      await ctx.prisma.dataset.update({
        where: {
          id: input.datasetId,
          projectId: input.projectId,
        },
        data: {
          slug: input.undo ? slug : `${slug}-archived-${nanoid()}`,
          archivedAt: input.undo ? null : new Date(),
        },
      });

      return { success: true };
    }),
  updateMapping: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        mapping: z.object({
          mapping: z.record(z.string(), z.any()),
          expansions: z.array(z.string()),
        }),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { projectId, datasetId, mapping } = input;
      return await ctx.prisma.dataset.update({
        where: { id: datasetId, projectId },
        data: { mapping },
      });
    }),
  /**
   * Find next available name for a dataset, given proposed name
   */
  findNextName: protectedProcedure
    .input(z.object({ projectId: z.string(), proposedName: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input }) => {
      const { projectId, proposedName } = input;
      return await findNextName(projectId, proposedName);
    }),
});

const findNextDatasetNameForExperiment = async (
  projectId: string,
  experimentId: string
) => {
  const experiment = await prisma.experiment.findFirst({
    where: { id: experimentId, projectId },
  });

  return await findNextName(projectId, experiment?.name ?? "Draft Dataset");
};

const findNextName = async (projectId: string, name: string) => {
  const datasets = await prisma.dataset.findMany({
    select: {
      name: true,
      slug: true,
    },
    where: {
      projectId: projectId,
    },
  });

  const slugs = new Set(datasets.map((dataset) => dataset.slug));

  let draftName;
  let index = 1;
  while (true) {
    draftName = index === 1 ? name : `${name} (${index})`;
    if (!slugs.has(slugify(draftName))) {
      break;
    }
    index++;
  }

  return draftName;
};
