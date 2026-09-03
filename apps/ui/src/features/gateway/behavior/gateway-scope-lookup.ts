/**
 * The organization, project and team a gateway page is about, resolved out of
 * the graph already in hand rather than asked for again.
 */

import type {
  GatewayOrganization,
  GatewayProject,
  GatewayTeam,
} from "@langwatch/gateway-web/screens/gateway";

export function resolveGatewayOrganization({
  organizations,
  organizationId,
}: {
  organizations: readonly GatewayOrganization[];
  organizationId: string | null;
}): GatewayOrganization | undefined {
  if (!organizationId) return void 0;
  return organizations.find((candidate) => candidate.id === organizationId);
}

/**
 * The project the address is about, found in the graph rather than fetched.
 *
 * Every organization the reader can reach is already in hand, so the project
 * behind the active scope is a lookup; a second read would be a second
 * request for a row that is on the page.
 */
export function resolveGatewayProject({
  organizations,
  projectId,
}: {
  organizations: readonly GatewayOrganization[];
  projectId: string | null;
}): GatewayProject | undefined {
  if (!projectId) return void 0;
  for (const organization of organizations) {
    for (const team of organization.teams) {
      const project = team.projects.find((candidate) => candidate.id === projectId);
      if (project) return project;
    }
  }
  return void 0;
}

export function resolveGatewayTeam({
  organizations,
  projectId,
}: {
  organizations: readonly GatewayOrganization[];
  projectId: string | null;
}): GatewayTeam | undefined {
  if (!projectId) return void 0;
  for (const organization of organizations) {
    const team = organization.teams.find((candidate) =>
      candidate.projects.some((project) => project.id === projectId),
    );
    if (team) return team;
  }
  return void 0;
}
