/**
 * Custom LLM model costs (regex + rate card) over tRPC. Carries no credentials, so
 * tenancy is the whole game: both write paths authorize against the scope the
 * resolver derives, never the caller-supplied `projectId`.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission, EnforcedScopeFields } from "@langwatch/authz-contract";
import {
  costRuleMatchingSpansPreviewSchema,
  createModelCostPreviewTrpcInputSchema,
  createModelCostWriteTrpcInputSchema,
  modelCostDeleteTrpcInputSchema,
  modelCostModelLimitsTrpcInputSchema,
  modelCostProjectTrpcInputSchema,
  modelCostSchema,
  modelLimitsSchema,
  type CostRuleMatchingSpansPreview,
  type ModelLimits,
  type ModelProviderScopeType,
} from "@langwatch/model-provider-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { ModelProviderApp, SpanReader } from "#app/model-provider.app";

/** Auth from the process; `app` is the {@link ModelProviderApp} used by the other surfaces. */
export type LlmModelCostTrpcContext = Readonly<{
  app: Readonly<{ modelProviders: ModelProviderApp }>;
  actor(): Readonly<{ id: string }>;
}>;

/** Applied after this feature's `.input()`: reads its scope id from the parsed input. */
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
  /** For a write checked in the resolver; `enforces` names the input fields it covers. */
  resolverAuthorizedPolicy(enforces: EnforcedScopeFields): ProcedureDecorator;
  /** Whether the chain checks every answer against its declared output schema. */
  validateOutput: boolean;
}>;

/**
 * Process capabilities beyond the Model Provider service's own. Declared as a
 * constraint so the process's concrete return shapes survive into the router's
 * inferred output types.
 */
export type LlmModelCostTrpcPorts = Readonly<{
  /** Catastrophic-backtracking check, as a port so the form/schema/gate agree. */
  isSafeRegex(pattern: string): boolean;
  /** The registry's context-window and output ceilings for a model id. */
  tryGetModelLimits(model: string): ModelLimits | null;
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
  }): Promise<CostRuleMatchingSpansPreview>;
}>;

/** Installs the `llmModelCost.*` tRPC surface; procedure and policy are process-injected. */
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
    // Built here rather than at module scope: the safety predicate is a port,
    // so the schemas cannot exist before the process has supplied one.
    const isSafeRegex = (pattern: string) => ports.isSafeRegex(pattern);
    const createOrUpdateInputSchema = createModelCostWriteTrpcInputSchema({ isSafeRegex });
    const previewMatchingSpansInputSchema = createModelCostPreviewTrpcInputSchema({ isSafeRegex });

    return (
      createTrpcService({
        root: trpc,
        procedures,
        validateOutput: procedures.validateOutput,
      })
        .query("getAllForProject", (p) =>
          p
            .withInput(modelCostProjectTrpcInputSchema)
            .withOutput(z.array(modelCostSchema))
            .withPermission("project:view")
            .handle(async ({ input, ctx }) => {
              return await ctx.app.modelProviders.listCosts(input);
            }),
        )
        .mutation("createOrUpdate", (p) =>
          p
            .withInput(createOrUpdateInputSchema)
            .withOutput(modelCostSchema)
            .withCustomPermission(
              procedures.resolverAuthorizedPolicy({
                projectId:
                  "assertCanManageScope: manage is required on the written scope, which defaults to this project; the scope then resolves to a single organization the cost is anchored to",
              }),
              "assertCanManageScope: manage is required on the written scope, which defaults to this project; the scope then resolves to a single organization the cost is anchored to",
            )
            .handle(async ({ input, ctx }) => {
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
              return await ctx.app.modelProviders.upsertCost(
                {
                  id,
                  projectId,
                  scopeType,
                  scopeId,
                  model,
                  regex,
                  inputCostPerToken,
                  outputCostPerToken,
                  cacheReadCostPerToken,
                  cacheCreationCostPerToken,
                  cacheCreation1hCostPerToken,
                },
                ctx.actor(),
              );
            }),
        )
        .mutation("delete", (p) =>
          p
            .withInput(modelCostDeleteTrpcInputSchema)
            .withOutput(z.void())
            .withCustomPermission(
              procedures.resolverAuthorizedPolicy({
                projectId:
                  "not trusted — the scope is derived from the stored row and assertCanManageScope runs against that scope, never the caller-supplied projectId",
              }),
              "not trusted — the scope is derived from the stored row and assertCanManageScope runs against that scope, never the caller-supplied projectId",
            )
            .handle(async ({ input, ctx }) => {
              // Derive the scope from the row itself, then authorize manage on that
              // scope. Never trust a caller-supplied scope for a delete.
              return await ctx.app.modelProviders.deleteCost(input, ctx.actor());
            }),
        )
        // TODO: doesn't need to be protected, but tRPC throws without a permission.
        .query("tryGetModelLimits", (p) =>
          p
            .withInput(modelCostModelLimitsTrpcInputSchema)
            .withOutput(modelLimitsSchema.nullable())
            .withPermission("project:view")
            .handle(async ({ input }) => ports.tryGetModelLimits(input.model)),
        )
        // Gated on traces:view: the response exposes span metadata, not cost-rule config.
        .query("previewMatchingSpans", (p) =>
          p
            .withInput(previewMatchingSpansInputSchema)
            .withOutput(costRuleMatchingSpansPreviewSchema)
            .withPermission("traces:view")
            .handle(async ({ input, ctx }) =>
              ports.previewMatchingSpans({ spans: ctx.app.modelProviders.spanReader, input }),
            ),
        )
        .build()
    );
  }
}
