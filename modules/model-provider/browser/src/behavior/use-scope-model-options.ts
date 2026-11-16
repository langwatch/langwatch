import {
  NO_SCOPE_MODEL_OPTIONS,
  type ModelDefaultScope,
  type ScopeModelOptions,
} from "@langwatch/model-provider-contract";

import { modelProviderApi } from "./model-provider-api.ts";

/**
 * The models the picked scopes' providers run, never the page's project's: a config on another
 * project or the organization runs on what those scopes hold. No scope picked asks nothing.
 */
export function useScopeModelOptions({
  projectId,
  scopes,
  enabled,
}: {
  projectId: string | undefined;
  scopes: readonly ModelDefaultScope[];
  enabled: boolean;
}): { options: ScopeModelOptions; isAnswered: boolean } {
  const query = modelProviderApi.modelProvider.getModelOptionsForScopes.useQuery(
    {
      projectId: projectId ?? "",
      scopes: scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId })),
    },
    { enabled: !!projectId && scopes.length > 0 && enabled },
  );
  // An empty picker is explained only once the scopes' answer is in; a failed read offers nothing.
  return {
    options: query.data ?? NO_SCOPE_MODEL_OPTIONS,
    isAnswered: scopes.length > 0 && !!query.data,
  };
}
