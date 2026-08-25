import {
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentNotFoundError,
  AgentSourceNotFoundError,
  createAgentCommandSchema,
  InvalidAgentConfigError,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { hasProjectPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { LegacyAgentPresenter } from "../features/agents";

function asTrpcError(error: unknown): never {
  if (error instanceof AgentNotFoundError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof AgentSourceNotFoundError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: error.message,
      cause: error,
    });
  }
  if (
    error instanceof InvalidAgentConfigError ||
    error instanceof AgentIsNotCopyError ||
    error instanceof AgentCopiesNotFoundError ||
    error instanceof AgentCopySelectionError
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

const withAgentErrors = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    return asTrpcError(error);
  }
};

const createInput = createAgentCommandSchema.transform((input) => ({
  ...input,
  id: input.id ?? `agent_${nanoid()}`,
}));

export const agentsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const agents = await withAgentErrors(() => ctx.app.agents.getAll(input));
      return agents.map(LegacyAgentPresenter.withCopyCount);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const agent = await withAgentErrors(() => ctx.app.agents.getById(input));
      return LegacyAgentPresenter.withCopyCount(agent);
    }),

  create: protectedProcedure
    .input(createInput)
    .permission("evaluations:manage")
    .mutation(({ ctx, input }) => withAgentErrors(() => ctx.app.agents.create(input))),

  update: protectedProcedure
    .input(updateAgentCommandSchema)
    .permission("evaluations:manage")
    .mutation(({ ctx, input }) => withAgentErrors(() => ctx.app.agents.update(input))),

  getRelatedEntities: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(({ ctx, input }) =>
      withAgentErrors(() => ctx.app.agents.relatedEntities(input)),
    ),

  cascadeArchive: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:manage")
    .mutation(({ ctx, input }) =>
      withAgentErrors(() => ctx.app.agents.cascadeArchive(input)),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:manage")
    .mutation(({ ctx, input }) => withAgentErrors(() => ctx.app.agents.archive(input))),

  getCopies: protectedProcedure
    .input(z.object({ projectId: z.string(), agentId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.agents;
      await withAgentErrors(() =>
        service.getById({ id: input.agentId, projectId: input.projectId }),
      );
      const copies = await withAgentErrors(() =>
        service.getCopies({ sourceAgentId: input.agentId }),
      );
      const authorized = await Promise.all(
        copies.map(async (copy) => ({
          copy,
          allowed: await hasProjectPermission(ctx, copy.projectId, "evaluations:view"),
        })),
      );
      return authorized.filter(({ allowed }) => allowed).map(({ copy }) => copy);
    }),

  copy: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        projectId: z.string(),
        sourceProjectId: z.string(),
        newAgentId: z.string().default(() => `agent_${nanoid()}`),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      if (
        !(await hasProjectPermission(ctx, input.sourceProjectId, "evaluations:manage"))
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to manage evaluations in the source project",
        });
      }
      return withAgentErrors(() =>
        ctx.app.agents.copy({
          sourceAgentId: input.agentId,
          sourceProjectId: input.sourceProjectId,
          targetProjectId: input.projectId,
          actorUserId: ctx.session.user.id,
          newAgentId: input.newAgentId,
        }),
      );
    }),

  pushToCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string(),
        copyIds: z.array(z.string()).optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.agents;
      const copies = await withAgentErrors(() =>
        service.getCopies({ sourceAgentId: input.agentId }),
      );
      const allowedIds = (
        await Promise.all(
          copies.map(async (copy) => ({
            id: copy.id,
            allowed: await hasProjectPermission(
              ctx,
              copy.projectId,
              "evaluations:manage",
            ),
          })),
        )
      )
        .filter(({ allowed }) => allowed)
        .map(({ id }) => id);
      const copyIds = input.copyIds
        ? input.copyIds.filter((id) => allowedIds.includes(id))
        : allowedIds;
      return withAgentErrors(() =>
        service.pushToCopies({
          sourceAgentId: input.agentId,
          sourceProjectId: input.projectId,
          copyIds,
        }),
      );
    }),

  syncFromSource: protectedProcedure
    .input(z.object({ projectId: z.string(), agentId: z.string() }))
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.agents;
      const source = await withAgentErrors(() => service.getSourceOfCopy(input));
      if (!(await hasProjectPermission(ctx, source.projectId, "evaluations:manage"))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to manage evaluations in the source project",
        });
      }
      return withAgentErrors(() =>
        service.syncFromSource({
          agentId: input.agentId,
          projectId: input.projectId,
        }),
      );
    }),

  getHistory: protectedProcedure
    .input(z.object({ agentId: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(({ ctx, input }) => withAgentErrors(() => ctx.app.agents.getHistory(input))),
});
