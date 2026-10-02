import { api } from "../trace-api.ts";

export function useOrganizationMembersWithTeams({
  organizationId,
  enabled = true,
}: {
  organizationId: string | undefined;
  enabled?: boolean;
}) {
  return api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && enabled },
  );
}
