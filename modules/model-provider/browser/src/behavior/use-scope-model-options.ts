import {
  NO_SCOPE_MODEL_OPTIONS,
  type ModelDefaultScope,
  type ScopeModelOptions,
} from "@langwatch/model-provider-contract";

import { modelProviderApi } from "./model-provider-api.ts";

/** Where the scopes' models read stands: a refusal is told apart from a failure worth retrying. */
export type ScopeModelOptionsRead = "idle" | "loading" | "answered" | "refused" | "failed";

/** Read structurally: a browser module may not import `@trpc/client` (ADR-004). */
function isRefusal(error: unknown): boolean {
  return (error as { data?: { code?: unknown } } | null)?.data?.code === "FORBIDDEN";
}

/** Held options stay on a failed re-read; only a read with nothing to show reports a failure. */
function readOf(query: { data?: unknown; isError: boolean; error: unknown }) {
  if (query.data) return "answered";
  if (!query.isError) return "loading";
  return isRefusal(query.error) ? "refused" : "failed";
}

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
}): { options: ScopeModelOptions; read: ScopeModelOptionsRead; retry: () => void } {
  const query = modelProviderApi.modelProvider.getModelOptionsForScopes.useQuery(
    {
      projectId: projectId ?? "",
      scopes: scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId })),
    },
    { enabled: !!projectId && scopes.length > 0 && enabled },
  );
  return {
    options: query.data ?? NO_SCOPE_MODEL_OPTIONS,
    read: scopes.length === 0 ? "idle" : readOf(query),
    retry: () => void query.refetch(),
  };
}
