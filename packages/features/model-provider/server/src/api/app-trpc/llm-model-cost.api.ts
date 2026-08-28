/**
 * Custom LLM model costs over the process's tRPC transport.
 *
 * A model cost is a regex plus a rate card, stored against one scope inside
 * one organization, and read back by the ingestion pipeline when it prices a
 * span. The surface is small on purpose:
 *
 *   getAllForProject    the rules the project's settings page renders.
 *   createOrUpdate      write one rule at a scope the caller may manage.
 *   delete              remove one, authorized against the STORED row's scope.
 *   getModelLimits      the registry's context/output ceilings for a model.
 *   previewMatchingSpans  which recently-seen models the regex being typed
 *                       would match, and what those spans would have cost.
 *
 * Costs carry no credentials, so nothing here is redacted on the way into the
 * audit log. Tenancy is the whole game instead: a scope target must resolve to
 * a single organization, and both write paths authorize inside the resolver
 * against the scope rather than against the caller-supplied `projectId`.
 *
 * Transport only: input parsing, the authorization declarations, and
 * delegation to `ModelProviderService`. The regex-safety predicate, the model
 * registry lookup and the span preview arrive as ports because they are
 * process capabilities rather than this feature's persistence.
 */
import type { AuthzPermission, EnforcedScopeFields } from "@langwatch/authz-contract";
import {
  createModelCostPreviewTrpcInputSchema,
  createModelCostWriteTrpcInputSchema,
  modelCostDeleteTrpcInputSchema,
  modelCostModelLimitsTrpcInputSchema,
  modelCostProjectTrpcInputSchema,
  type ModelProviderScopeType,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The process's span reader, opaque here. The preview port below owns its
 * shape; this transport only carries the handle from the context to the port
 * so the preview reads through the SAME request-scoped services as the rest
 * of the call rather than a process singleton.
 */
type SpanReader = unknown;

type LlmModelCostApplication = Readonly<{
  modelProviders: ModelProviderService;
  traces: Readonly<{ spans: SpanReader }>;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type LlmModelCostTrpcContext = Readonly<{
  app: LlmModelCostApplication;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * A process middleware chain applied to one already-parsed procedure.
 *
 * Applied AFTER the feature's own `.input()` rather than composed ahead of
 * it: tRPC runs middlewares in the order they were added, so a check
 * installed before the parser would see no input to read a scope id from.
 */
type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type LlmModelCostTrpcProcedures<
  TContext extends LlmModelCostTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's full policy chain for one declared permission. */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /**
   * The declaration for a write whose real check happens in the resolver,
   * against a scope loaded at runtime. `enforces` names each input field the
   * resolver is claiming to have covered, with the reason it may be trusted.
   */
  resolverAuthorizedPolicy(enforces: EnforcedScopeFields): ProcedureDecorator;
}>;

/**
 * The process capabilities this transport needs that are not the Model
 * Provider service's own.
 *
 * Declared as a constraint and consumed through the generic below, so the
 * concrete return shapes the process wires in survive into the router's
 * inferred output types instead of collapsing to the loose shape here.
 */
type LlmModelCostTrpcPorts = Readonly<{
  /**
   * Whether a caller-supplied pattern is free of catastrophic backtracking.
   * A port rather than a local copy so the form, this schema and the
   * match-time gate can never disagree about which patterns are allowed.
   */
  isSafeRegex(pattern: string): boolean;
  /** The registry's context-window and output ceilings for a model id. */
  getModelLimits(model: string): unknown;
  /** The live preview behind the cost-rule drawer's regex field. */
  previewMatchingSpans(input: {
    spans: SpanReader;
    input: {
      projectId: string;
      regex: string;
      model?: string;
      inputCostPerToken?: number;
      outputCostPerToken?: number;
      cacheReadCostPerToken?: number;
      cacheCreationCostPerToken?: number;
      cacheCreation1hCostPerToken?: number;
    };
  }): Promise<unknown>;
}>;

/**
 * Installs the complete `llmModelCost.*` tRPC surface on a process-owned
 * root. The procedure and the policy bag are injected by the process so its
 * auth, audit, error, logging and tracing policies wrap every feature
 * procedure consistently.
 */
export class LlmModelCostTrpcApi {
  static create<
    TContext extends LlmModelCostTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends LlmModelCostTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LlmModelCostTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy, resolverAuthorizedPolicy } = procedures;
    // Built here rather than at module scope: the safety predicate is a port,
    // so the schemas cannot exist before the process has supplied one.
    const isSafeRegex = (pattern: string) => ports.isSafeRegex(pattern);
    const createOrUpdateInputSchema = createModelCostWriteTrpcInputSchema({ isSafeRegex });
    const previewMatchingSpansInputSchema = createModelCostPreviewTrpcInputSchema({ isSafeRegex });

    return trpc.router({
      getAllForProject: policy("project:view")(
        procedure.input(modelCostProjectTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return await ctx.app.modelProviders.listCosts(input);
      }),

      createOrUpdate: resolverAuthorizedPolicy({
        projectId:
          "assertCanManageScope: manage is required on the written scope, which defaults to this project; the scope then resolves to a single organization the cost is anchored to",
      })(procedure.input(createOrUpdateInputSchema)).mutation(async ({ input, ctx }) => {
        const {
          id,
          projectId,
          model,
          inputCostPerToken,
          outputCostPerToken,
          cacheReadCostPerToken,
          cacheCreationCostPerToken,
          cacheCreation1hCostPerToken,
          regex,
        } = input;

        const scopeType: ModelProviderScopeType = input.scopeType ?? "PROJECT";
        const scopeId = input.scopeId ?? projectId;

        // The caller must hold manage on the scope they are writing to
        // (organization:manage / team:manage / project:manage), and the scope
        // must resolve to a single organization the cost is then anchored to.
        return await ctx.app.modelProviders.upsertCost({
          id,
          projectId,
          scopeType,
          scopeId,
          model,
          regex,
          actorId: ctx.actor().id,
          inputCostPerToken,
          outputCostPerToken,
          cacheReadCostPerToken,
          cacheCreationCostPerToken,
          cacheCreation1hCostPerToken,
        });
      }),

      delete: resolverAuthorizedPolicy({
        projectId:
          "not trusted — the scope is derived from the stored row and assertCanManageScope runs against that scope, never the caller-supplied projectId",
      })(procedure.input(modelCostDeleteTrpcInputSchema)).mutation(async ({ input, ctx }) => {
        // Derive the scope from the row itself, then authorize manage on that
        // scope. Never trust a caller-supplied scope for a delete.
        return await ctx.app.modelProviders.deleteCost({
          ...input,
          actorId: ctx.actor().id,
        });
      }),

      /**
       * Get model limits for a given model
       * TODO: This doesn't need to be protected, but TRPC throws without it
       * @param input - Input containing the project ID and model name
       * @returns Model limits or null if not found
       */
      getModelLimits: policy("project:view")(
        procedure.input(modelCostModelLimitsTrpcInputSchema),
      ).query(async ({ input }) => ports.getModelLimits(input.model)),

      /**
       * Live preview for the cost rule drawer: which recently-seen models (and
       * sample spans) would this regex match, and what would those spans cost at
       * the rates being edited. Gated on traces:view, the response exposes span
       * metadata (model names, token counts, trace ids), not cost-rule config.
       */
      previewMatchingSpans: policy("traces:view")(
        procedure.input(previewMatchingSpansInputSchema),
      ).query(async ({ input, ctx }) =>
        ports.previewMatchingSpans({ spans: ctx.app.traces.spans, input }),
      ),
    });
  }
}
