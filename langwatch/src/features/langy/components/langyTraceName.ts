import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { shortenChipId } from "../logic/langyContextChips";

/**
 * The ONE trace display-name derivation for Langy's context surfaces.
 *
 * An id is useful to a tool, not to a person. Everywhere the app names a trace
 * for a human it walks the same chain — the resolved trace name (which the
 * server derives from the trace summary / first message / root span), then the
 * root span's own name, then a shortened id as the last resort. That chain lived
 * inline in ~8 places with no shared function; this is it, once, so a Langy
 * context chip reads the same way the trace drawer's header does.
 *
 * The span-name step mirrors the drawer header: a root-span name that is just
 * the id (or a prefix of it) is no better than the id, so it is skipped.
 */
export function traceDisplayName(trace: {
  traceName?: string | null;
  name?: string | null;
  traceId: string;
}): string {
  const resolved = trace.traceName?.trim();
  if (resolved) return resolved;

  const spanName = trace.name?.trim();
  if (
    spanName &&
    spanName !== trace.traceId &&
    !trace.traceId.startsWith(spanName)
  ) {
    return spanName;
  }

  return shortenChipId(trace.traceId);
}

/**
 * Resolve a human-friendly name for a trace we only know by id — reusing the
 * app's own trace header query, so no id formatting is hand-rolled and the name
 * matches what the trace drawer shows. Returns null until it resolves (callers
 * fall back to whatever label they already have).
 *
 * `enabled` gates the fetch: pass it false when the caller already holds a human
 * label, so the (server-side, summary-heavy) header query only fires for the
 * route-derived chips that genuinely have nothing but an id.
 */
export function useResolvedTraceName(
  traceId: string | undefined | null,
  { enabled = true }: { enabled?: boolean } = {},
): string | null {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const query = api.tracesV2.header.useQuery(
    { projectId: projectId ?? "", traceId: traceId ?? "" },
    {
      enabled: enabled && !!projectId && !!traceId,
      // A trace's name barely changes; keep it cached across hovers.
      staleTime: 5 * 60 * 1000,
    },
  );

  if (!traceId || !query.data) return null;
  return traceDisplayName({
    traceName: query.data.traceName,
    name: query.data.name,
    traceId,
  });
}
