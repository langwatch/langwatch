import { useOptionalTraceHost } from "../../../../behavior/trace-host.ts";

/**
 * The name of the member project an aggregate's row was listed from (ADR-177), as the host
 * knows it; the id stands in when the reader cannot see that project.
 */
export function useMemberProjectName(projectId: string | null | undefined): string | null {
  const host = useOptionalTraceHost();
  if (!projectId) return null;
  return host?.projectName(projectId) ?? projectId;
}
