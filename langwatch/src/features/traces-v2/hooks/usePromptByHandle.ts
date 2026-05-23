import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Live lookup of a prompt's *current* version by id-or-handle.
 *
 * NOT_FOUND is mapped to an error rather than a typed "missing" payload by
 * the underlying procedure — callers treat `isError` as "prompt was deleted
 * (or never existed)" via the `missing` derived flag.
 */
export function usePromptByHandle(handle: string | null | undefined) {
  const { project } = useOrganizationTeamProject();
  const lookup = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: handle ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!handle,
      staleTime: 60_000,
      retry: false,
    },
  );
  return {
    ...lookup,
    latestVersion: lookup.data?.version ?? null,
    // Friendly human-readable handle (e.g. "pizza-prompt") when the SDK
    // emitted the opaque slug-id form (`prompt_xxx`). Null when the prompt
    // never had a handle or the lookup hasn't resolved yet.
    resolvedHandle: lookup.data?.handle ?? null,
    missing: !!handle && lookup.isError,
  };
}
