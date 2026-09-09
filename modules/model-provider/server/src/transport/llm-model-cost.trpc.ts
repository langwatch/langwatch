/**
 * The server half of `llmModelCost.*`. Custom cost rules carry no credentials,
 * so tenancy is the whole game: both writes are authorized against the scope
 * the application resolves, never the caller-supplied `projectId`.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  ModelProviderApi,
  llmModelCostTrpc,
  type ModelProviderScopeType,
} from "@langwatch/model-provider-contract";

/** Which permissions the application enforces on a cost-rule write. */
const COST_WRITE_PERMISSIONS = ["project:update", "team:manage", "organization:manage"] as const;

const WRITTEN_SCOPE_DECIDES =
  "assertCanManageScope: manage is required on the written scope, which defaults to this project; the scope then resolves to a single organization the cost is anchored to";

const STORED_SCOPE_DECIDES =
  "not trusted — the scope is derived from the stored row and assertCanManageScope runs against that scope, never the caller-supplied projectId";

export const llmModelCostTrpcTransport = defineTrpcRouter(ModelProviderApi, llmModelCostTrpc)
  .procedure("getAllForProject")
  .withPermission("project:view")
  .handle(({ app, input }) => app.listCosts(input))

  .procedure("createOrUpdate")
  .serviceAuthorized({
    reason: WRITTEN_SCOPE_DECIDES,
    permissions: COST_WRITE_PERMISSIONS,
    enforces: { projectId: WRITTEN_SCOPE_DECIDES },
  })
  // The caller must hold manage on the scope they are writing to
  // (organization:manage / team:manage / project:manage), and that scope must
  // resolve to a single organization the cost is then anchored to.
  .handle(({ app, input, actor }) => {
    const scopeType: ModelProviderScopeType = input.scopeType ?? "PROJECT";

    return app.upsertCost(
      {
        id: input.id,
        projectId: input.projectId,
        scopeType,
        scopeId: input.scopeId ?? input.projectId,
        model: input.model,
        regex: input.regex,
        inputCostPerToken: input.inputCostPerToken,
        outputCostPerToken: input.outputCostPerToken,
        cacheReadCostPerToken: input.cacheReadCostPerToken,
        cacheCreationCostPerToken: input.cacheCreationCostPerToken,
        cacheCreation1hCostPerToken: input.cacheCreation1hCostPerToken,
      },
      actor,
    );
  })

  // The scope is derived from the row itself, then manage is authorized on
  // that scope. A caller-supplied scope is never trusted for a delete.
  .procedure("delete")
  .serviceAuthorized({
    reason: STORED_SCOPE_DECIDES,
    permissions: COST_WRITE_PERMISSIONS,
    enforces: { projectId: STORED_SCOPE_DECIDES },
  })
  .handle(async ({ app, input, actor }) => {
    await app.deleteCost(input, actor);
  })

  // Behind project:view because tRPC asks every procedure for a declaration,
  // not because a model's ceilings are a tenant's secret.
  .procedure("tryGetModelLimits")
  .withPermission("project:view")
  .handle(({ app, input }) => app.findModelLimits({ model: input.model }))

  // Gated on traces:view: the answer exposes span metadata, not cost-rule config.
  .procedure("previewMatchingSpans")
  .withPermission("traces:view")
  .handle(({ app, input }) => app.previewCostRuleMatchingSpans(input))
  .build();
