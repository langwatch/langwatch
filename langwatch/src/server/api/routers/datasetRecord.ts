import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { nanoid } from "nanoid";
import {
  chatMessageSchema,
  datasetSpanSchema,
} from "~/server/tracer/types.generated";
import { DatabaseSchema } from "@prisma/client";
import { TRPCError } from "@trpc/server";

const LLMChatSchema = z.object({
  input: z.array(chatMessageSchema),
  expected_output: z.array(chatMessageSchema),
});

const FullTraceSchema = z.object({
  input: z.string(),
  expected_output: z.string(),
  spans: z.array(datasetSpanSchema),
});

const StringIOSchema = z.object({
  input: z.string(),
  expected_output: z.string(),
});

export const datasetRecordRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        datasetSchema: z.string(),
        datasetId: z.string(),
        entries: z.array(z.unknown()), // Fix: Provide the missing argument for z.array()
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const recordData = [];

      for (const entry of input.entries) {
        let validatedInput = null;
        let entryInput = {};
        if (input.datasetSchema === DatabaseSchema.LLM_CHAT_CALL) {
          validatedInput = LLMChatSchema.safeParse(entry);
          entryInput = validatedInput.success
            ? {
                input: validatedInput.data.input,
                expected_output: validatedInput.data.expected_output,
              }
            : {};
        } else if (input.datasetSchema === DatabaseSchema.FULL_TRACE) {
          validatedInput = FullTraceSchema.safeParse(entry);
          entryInput = validatedInput.success
            ? {
                input: validatedInput.data.input,
                expected_output: validatedInput.data.expected_output,
                spans: validatedInput.data.spans,
              }
            : {};
        } else if (input.datasetSchema === DatabaseSchema.STRING_I_O) {
          validatedInput = StringIOSchema.safeParse(entry);
          entryInput = validatedInput.success
            ? {
                input: validatedInput.data.input,
                expected_output: validatedInput.data.expected_output,
              }
            : {};
        }

        if (validatedInput && validatedInput.success) {
          recordData.push({
            id: nanoid(),
            entry: entryInput,
            datasetId: input.datasetId,
          });
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "PLEASE PROVIDE VALID INPUTS",
          });
        }
      }

      return ctx.prisma.datasetRecord.createMany({
        data: recordData,
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findFirst({
        where: { id: input.datasetId },
        include: {
          datasetRecords: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      return datasets;
    }),
});
