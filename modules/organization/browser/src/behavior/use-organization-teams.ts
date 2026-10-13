import { api } from "./organization-api.ts";

/** The organization's teams and their project names, off the shell's scope graph. */
export function useOrganizationTeams({ organizationId }: { organizationId: string | undefined }) {
  const graph = api.organization.getScopeGraph.useQuery({});
  return graph.data?.find((candidate) => candidate.id === organizationId)?.teams;
}
