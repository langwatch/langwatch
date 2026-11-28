import { GatewayScopeOrgMismatchError } from "@langwatch/gateway-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";

/** Refuses a project, as the directory found it, that is missing or in another organization. */
export function assertProjectInOrganization({
  project,
  organizationId,
}: {
  project: ProjectWithTeam | null;
  organizationId: string;
}): void {
  if (project?.team.organizationId !== organizationId) {
    throw new GatewayScopeOrgMismatchError("project");
  }
}
