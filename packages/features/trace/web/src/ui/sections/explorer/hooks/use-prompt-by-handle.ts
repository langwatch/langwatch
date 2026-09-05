import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/trace-api";
import { useIsReadOnlyTrace } from "../../../elements/explorer/context/trace-viewer-context";

/**
 * Live lookup of a prompt's *current* version by id-or-handle.
 */
export function usePromptByHandle(handle: string | null | undefined) {
  const { project } = useOrganizationTeamProject();
  const isReadOnly = useIsReadOnlyTrace();
  const lookup = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: handle ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!handle && !isReadOnly,
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
