import {
  agentApiAgentInputSchema,
  agentApiAgentReferenceInputSchema,
  agentApiCopyInputSchema,
  agentApiCreateInputSchema,
  agentApiProjectInputSchema,
  agentApiPushToCopiesInputSchema,
  agentApiTestTurnInputSchema,
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentNotFoundError,
  AgentSourceNotFoundError,
  InvalidAgentConfigError,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";
import type { AgentApiUpdateOutput } from "@langwatch/agent-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { AgentApp } from "#app/agent.app";

/**
 * The slice of the process's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. The REST family, built per door,
 * holds {@link AgentApp} directly. Both reach the same object.
 */
type AgentApplication = Readonly<{ agents: AgentApp }>;

/** The process supplies authentication, authorization and audit policy. */
export type AgentTrpcContext = Readonly<{
  app: AgentApplication;
  actor(): Readonly<{ id: string }>;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  /** Rejects a command whose declared scope ids cross tenant boundaries. */
  authorizeScopeLineage?(input: unknown, permission: AuthzPermission): Promise<void>;
}>;

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to this package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

type AuthorizationMiddlewareParams = Readonly<{
  ctx: AgentTrpcContext;
  input: Readonly<{ projectId: string }>;
  next(): Promise<unknown>;
}>;

/**
 * The fallback for a process that supplies no policy of its own: exactly the
 * context authorization the handlers used to run inline, lifted onto the
 * procedure so the check is the procedure's rather than the handler's. Scope
 * lineage is refused first, in the order the declared policy uses.
 */
const contextAuthorizationPolicy =
  (permission: AuthzPermission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure).use(
      async ({ ctx, input, next }: AuthorizationMiddlewareParams) => {
        await ctx.authorizeScopeLineage?.(input, permission);
        await ctx.authorize(permission, { projectId: input.projectId });
        return next();
      },
    ) as unknown as TProcedure;

type AgentTrpcProcedures<
  TContext extends AgentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all — which is
   * also what left `scopeLineageGuard` inert and the declaration missing while
   * these procedures authorized inside their handlers.
   *
   * Optional: a process that declares none falls back to
   * `contextAuthorizationPolicy`, so authorization never depends on the
   * process remembering to pass this.
   */
  policy?(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
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

/**
 * The agent-id scheme, handed to the two schemas that mint one. It is the
 * application's rather than this door's: the REST family mints the same ids
 * from the same place.
 */
const createInput = agentApiCreateInputSchema(AgentApp.nextAgentId);
const copyInput = agentApiCopyInputSchema(AgentApp.nextAgentId);

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
    const { protected: procedure, policy = contextAuthorizationPolicy } = procedures;

    return trpc.router({
      getAll: policy("evaluations:view")(procedure.input(agentApiProjectInputSchema)).query(
        async ({ ctx, input }) => {
          ctx.actor();
          const agents = await withAgentErrors(() => ctx.app.agents.getAll(input));
          return agents.map(withLegacyCopyCount);
        },
      ),

      getById: policy("evaluations:view")(procedure.input(agentApiAgentInputSchema)).query(
        async ({ ctx, input }) => {
          ctx.actor();
          const agent = await withAgentErrors(() => ctx.app.agents.getById(input));
          return withLegacyCopyCount(agent);
        },
      ),

      create: policy("evaluations:manage")(procedure.input(createInput)).mutation(
        async ({ ctx, input }) => {
          ctx.actor();
          return withAgentErrors(() => ctx.app.agents.create(input));
        },
      ),

      update: policy("evaluations:manage")(procedure.input(updateAgentCommandSchema)).mutation(
        async ({ ctx, input }): Promise<AgentApiUpdateOutput> => {
          ctx.actor();
          return withAgentErrors(() => ctx.app.agents.update(input));
        },
      ),

      getRelatedEntities: policy("evaluations:view")(
        procedure.input(agentApiAgentInputSchema),
      ).query(async ({ ctx, input }) => {
        ctx.actor();
        return withAgentErrors(() => ctx.app.agents.relatedEntities(input));
      }),

      cascadeArchive: policy("evaluations:manage")(
        procedure.input(agentApiAgentInputSchema),
      ).mutation(async ({ ctx, input }) => {
        ctx.actor();
        return withAgentErrors(() => ctx.app.agents.cascadeArchive(input));
      }),

      delete: policy("evaluations:manage")(procedure.input(agentApiAgentInputSchema)).mutation(
        async ({ ctx, input }) => {
          ctx.actor();
          return withAgentErrors(() => ctx.app.agents.archive(input));
        },
      ),

      getCopies: policy("evaluations:view")(
        procedure.input(agentApiAgentReferenceInputSchema),
      ).query(async ({ ctx, input }) => {
        ctx.actor();
        await withAgentErrors(() =>
          ctx.app.agents.getById({ id: input.agentId, projectId: input.projectId }),
        );
        const copies = await withAgentErrors(() =>
          ctx.app.agents.getCopies({ sourceAgentId: input.agentId }),
        );
        // Each copy lives in its own project, which the declared check on the
        // named project cannot reach: a caller who may read here has proved
        // nothing about the projects the copies sit in.
        const permitted = await Promise.all(
          copies.map(async (copy) => ({
            copy,
            allowed: await ctx.can("evaluations:view", { projectId: copy.projectId }),
          })),
        );
        return permitted.filter(({ allowed }) => allowed).map(({ copy }) => copy);
      }),

      copy: policy("evaluations:manage")(procedure.input(copyInput)).mutation(
        async ({ ctx, input }) => {
          const actor = ctx.actor();
          // The source project is a second scope the declaration cannot express;
          // it is the caller's own input, so nothing else proves it is theirs.
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
        },
      ),

      pushToCopies: policy("evaluations:manage")(
        procedure.input(agentApiPushToCopiesInputSchema),
      ).mutation(async ({ ctx, input }) => {
        ctx.actor();
        const copies = await withAgentErrors(() =>
          ctx.app.agents.getCopies({ sourceAgentId: input.agentId }),
        );
        // Same second scope as `getCopies`, on the write side: the push only
        // reaches copies in projects this caller may manage.
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

      syncFromSource: policy("evaluations:manage")(
        procedure.input(agentApiAgentReferenceInputSchema),
      ).mutation(async ({ ctx, input }) => {
        ctx.actor();
        const source = await withAgentErrors(() => ctx.app.agents.getSourceOfCopy(input));
        // The source project is resolved from stored data, not named in the
        // input, so the declaration has no id to check it at.
        if (!(await ctx.can("evaluations:manage", { projectId: source.projectId }))) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to manage evaluations in the source project",
          });
        }
        return withAgentErrors(() => ctx.app.agents.syncFromSource(input));
      }),

      getHistory: policy("evaluations:view")(
        procedure.input(agentApiAgentReferenceInputSchema),
      ).query(async ({ ctx, input }) => {
        ctx.actor();
        return withAgentErrors(() => ctx.app.agents.getHistory(input));
      }),

      /**
       * Sends one turn to an agent and answers what it returned. The Test
       * panel of the agent drawers.
       */
      testTurn: policy("evaluations:manage")(
        procedure.input(agentApiTestTurnInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        return ctx.app.agents.testTurn({
          id: input.id,
          projectId: input.projectId,
          message: input.message,
          params: input.params,
          actorId: actor.id,
        });
      }),

      /**
       * Schedules one scripted "Test agent" run, saving nothing. The "Test
       * agent" item of the agent card menu.
       */
      testRun: policy("scenarios:create")(
        procedure.input(agentApiAgentReferenceInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        return ctx.app.agents.testRun({
          agentId: input.agentId,
          projectId: input.projectId,
          actorId: actor.id,
        });
      }),
    });
  }
}
