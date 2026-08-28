import {
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentNotFoundError,
  AgentSourceNotFoundError,
  createAgentCommandSchema,
  InvalidAgentConfigError,
  type AgentService,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";

type AgentApplication = Readonly<{ agents: AgentService }>;

/** The process supplies authentication, authorization and audit policy. */
export type AgentTrpcContext = Readonly<{
  app: AgentApplication;
  actor(): Readonly<{ id: string }>;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  /** Rejects a command whose declared scope ids cross tenant boundaries. */
  authorizeScopeLineage?(input: unknown, permission: AuthzPermission): Promise<void>;
}>;

type AgentTrpcProcedures<
  TContext extends AgentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
}>;

function asTrpcError(error: unknown): never {
  if (error instanceof AgentNotFoundError || error instanceof AgentSourceNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }

  if (
    error instanceof InvalidAgentConfigError ||
    error instanceof AgentIsNotCopyError ||
    error instanceof AgentCopiesNotFoundError ||
    error instanceof AgentCopySelectionError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  throw error;
}

async function withAgentErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return asTrpcError(error);
  }
}

function withLegacyCopyCount<T extends { copyCount?: number }>(agent: T) {
  return { ...agent, _count: { copiedAgents: agent.copyCount ?? 0 } };
}

const createInput = createAgentCommandSchema.transform((input) => ({
  ...input,
  id: input.id ?? `agent_${nanoid()}`,
}));

/**
 * Installs the complete legacy `agents.*` tRPC surface on a process-owned root.
 * The procedure is injected by the process so its auth, audit, error, logging
 * and tracing policies wrap every feature procedure consistently.
 */
export class AgentTrpcApi {
  static create<
    TContext extends AgentTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AgentTrpcProcedures<TContext, TOptions, TRoot> = {
      protected: trpc.procedure,
    },
  ) {
    const procedure = procedures.protected;

    return trpc.router({
      getAll: procedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
        ctx.actor();
        await ctx.authorize("evaluations:view", { projectId: input.projectId });
        const agents = await withAgentErrors(() => ctx.app.agents.getAll(input));
        return agents.map(withLegacyCopyCount);
      }),

      getById: procedure
        .input(z.object({ id: z.string(), projectId: z.string() }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:view", { projectId: input.projectId });
          const agent = await withAgentErrors(() => ctx.app.agents.getById(input));
          return withLegacyCopyCount(agent);
        }),

      create: procedure.input(createInput).mutation(async ({ ctx, input }) => {
        ctx.actor();
        await ctx.authorize("evaluations:manage", { projectId: input.projectId });
        return withAgentErrors(() => ctx.app.agents.create(input));
      }),

      update: procedure.input(updateAgentCommandSchema).mutation(async ({ ctx, input }) => {
        ctx.actor();
        await ctx.authorize("evaluations:manage", { projectId: input.projectId });
        return withAgentErrors(() => ctx.app.agents.update(input));
      }),

      getRelatedEntities: procedure
        .input(z.object({ id: z.string(), projectId: z.string() }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:view", { projectId: input.projectId });
          return withAgentErrors(() => ctx.app.agents.relatedEntities(input));
        }),

      cascadeArchive: procedure
        .input(z.object({ id: z.string(), projectId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:manage", { projectId: input.projectId });
          return withAgentErrors(() => ctx.app.agents.cascadeArchive(input));
        }),

      delete: procedure
        .input(z.object({ id: z.string(), projectId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:manage", { projectId: input.projectId });
          return withAgentErrors(() => ctx.app.agents.archive(input));
        }),

      getCopies: procedure
        .input(z.object({ projectId: z.string(), agentId: z.string() }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:view", { projectId: input.projectId });
          await withAgentErrors(() =>
            ctx.app.agents.getById({ id: input.agentId, projectId: input.projectId }),
          );
          const copies = await withAgentErrors(() =>
            ctx.app.agents.getCopies({ sourceAgentId: input.agentId }),
          );
          const permitted = await Promise.all(
            copies.map(async (copy) => ({
              copy,
              allowed: await ctx.can("evaluations:view", { projectId: copy.projectId }),
            })),
          );
          return permitted.filter(({ allowed }) => allowed).map(({ copy }) => copy);
        }),

      copy: procedure
        .input(
          z.object({
            agentId: z.string(),
            projectId: z.string(),
            sourceProjectId: z.string(),
            newAgentId: z.string().default(() => `agent_${nanoid()}`),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const actor = ctx.actor();
          await ctx.authorizeScopeLineage?.(input, "evaluations:manage");
          await ctx.authorize("evaluations:manage", { projectId: input.projectId });
          if (!(await ctx.can("evaluations:manage", { projectId: input.sourceProjectId }))) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to manage evaluations in the source project",
            });
          }
          return withAgentErrors(() =>
            ctx.app.agents.copy({
              sourceAgentId: input.agentId,
              sourceProjectId: input.sourceProjectId,
              targetProjectId: input.projectId,
              actorUserId: actor.id,
              newAgentId: input.newAgentId,
            }),
          );
        }),

      pushToCopies: procedure
        .input(
          z.object({
            projectId: z.string(),
            agentId: z.string(),
            copyIds: z.array(z.string()).optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:manage", { projectId: input.projectId });
          const copies = await withAgentErrors(() =>
            ctx.app.agents.getCopies({ sourceAgentId: input.agentId }),
          );
          const permissions = await Promise.all(
            copies.map(async (copy) => ({
              id: copy.id,
              allowed: await ctx.can("evaluations:manage", { projectId: copy.projectId }),
            })),
          );
          const allowedIds = permissions.filter(({ allowed }) => allowed).map(({ id }) => id);
          const copyIds = input.copyIds
            ? input.copyIds.filter((id) => allowedIds.includes(id))
            : allowedIds;
          return withAgentErrors(() =>
            ctx.app.agents.pushToCopies({
              sourceAgentId: input.agentId,
              sourceProjectId: input.projectId,
              copyIds,
            }),
          );
        }),

      syncFromSource: procedure
        .input(z.object({ projectId: z.string(), agentId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:manage", { projectId: input.projectId });
          const source = await withAgentErrors(() => ctx.app.agents.getSourceOfCopy(input));
          if (!(await ctx.can("evaluations:manage", { projectId: source.projectId }))) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to manage evaluations in the source project",
            });
          }
          return withAgentErrors(() => ctx.app.agents.syncFromSource(input));
        }),

      getHistory: procedure
        .input(z.object({ agentId: z.string(), projectId: z.string() }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("evaluations:view", { projectId: input.projectId });
          return withAgentErrors(() => ctx.app.agents.getHistory(input));
        }),
    });
  }
}
