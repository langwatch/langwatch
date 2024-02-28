import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { nanoid } from "nanoid";
import { chatMessageSchema, datasetSpanSchema } from "~/server/tracer/types.generated";
import { DatabaseSchema } from "@prisma/client";
import { TRPCError } from "@trpc/server";


const LLMChatSchema = z.object({
  input: z.array(chatMessageSchema),
  output: z.array(chatMessageSchema)
});

const FullTraceSchema = z.object({
  input: z.string(),
  output: z.string(),
  spans: z.array(datasetSpanSchema),
});

const StringIOSchema = z.object({
  input: z.string(),
  output: z.string(),
});



export const datasetRecordRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetSchema: z.string(), datasetId: z.string(), input: z.any(), output: z.any(), spans: z.any().optional() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .mutation(async ({ ctx, input }) => {

      let validatedInput = null;
      let entry = {};

      if (input.datasetSchema === DatabaseSchema.LLM_CHAT_CALL) {
        validatedInput = LLMChatSchema.safeParse(input);
        entry = validatedInput.success ? { input: validatedInput.data.input, output: validatedInput.data.output } : {};
      } else if (input.datasetSchema === DatabaseSchema.FULL_TRACE) {
        validatedInput = FullTraceSchema.safeParse(input);
        entry = validatedInput.success ? { input: input.input, output: input.output, spans: validatedInput.data } : {};
      } else if (input.datasetSchema === DatabaseSchema.STRING_I_O) {
        validatedInput = StringIOSchema.safeParse(input);
        entry = validatedInput.success ? { input: input.input, output: input.output } : {};
      }


      if (validatedInput && validatedInput.success) {
        return ctx.prisma.datasetRecord.create({
          data: {
            id: nanoid(),
            entry: entry,
            datasetId: input.datasetId,
          },
        });
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "PLEASE PROVIDE VALID INPUTS",
        });
      }
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const datasets = await prisma.dataset.findFirst({
        where: { id: input.datasetId },
        include: {
          datasetRecords: {
            orderBy: { createdAt: 'desc' },
          }
        },
      });

      return datasets;
    }),
});
